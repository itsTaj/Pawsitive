import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import haversine from 'haversine-distance';

// In-memory stores (replace with DB in production)
const rides = new Map(); // rideId -> { id, initiatorId, start, end, totalFare, isOpen, participants, createdAt }
const users = new Map(); // userId -> { id, name }

const app = express();
app.use(cors());
app.use(express.json());

function computeDistanceMeters(a, b) {
  // a, b: { lat, lng }
  return haversine({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng });
}

function isDestinationAlongRoute(candidate, start, end, toleranceMeters = 300) {
  // Simple check: distance(start->end) ~= distance(start->candidate) + distance(candidate->end) within tolerance
  const total = computeDistanceMeters(start, end);
  const via = computeDistanceMeters(start, candidate) + computeDistanceMeters(candidate, end);
  return Math.abs(via - total) <= toleranceMeters;
}

function calculateFareSplit(ride, newRiderDest) {
  // Distance-based: shared segment divided equally, solo segments paid by respective rider
  // Assumptions: initiator travels full from ride.start to ride.end. New rider joins at current location ~ ride.start.
  const dStartToEnd = computeDistanceMeters(ride.start, ride.end);
  const dStartToNew = computeDistanceMeters(ride.start, newRiderDest);

  const sharedMeters = Math.min(dStartToEnd, dStartToNew);
  const soloInitiatorMeters = Math.max(0, dStartToEnd - sharedMeters);
  const soloNewMeters = Math.max(0, dStartToNew - sharedMeters);

  // Price per meter
  const pricePerMeter = ride.totalFare / dStartToEnd;

  const sharedCost = sharedMeters * pricePerMeter;
  const initiatorSoloCost = soloInitiatorMeters * pricePerMeter;
  const newSoloCost = soloNewMeters * pricePerMeter;

  const initiatorShare = sharedCost / 2 + initiatorSoloCost;
  const newRiderShare = sharedCost / 2 + newSoloCost;

  // Guard for floating point drift
  const total = Math.round((initiatorShare + newRiderShare) * 100) / 100;
  const totalFareRounded = Math.round(ride.totalFare * 100) / 100;
  const adjust = totalFareRounded - total;

  return {
    initiatorShare: Math.round((initiatorShare + adjust) * 100) / 100,
    newRiderShare: Math.round(newRiderShare * 100) / 100,
    sharedMeters,
    soloInitiatorMeters,
    soloNewMeters,
  };
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Create ride by initiator
app.post('/rides', async (req, res) => {
  try {
    const { initiatorId, start, end, totalFare } = req.body;
    if (!initiatorId || !start || !end || !totalFare) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const rideId = uuidv4();
    const ride = {
      id: rideId,
      initiatorId,
      start,
      end,
      totalFare,
      isOpen: true,
      participants: [initiatorId],
      createdAt: new Date().toISOString(),
      payments: [],
      ratings: [],
    };
    rides.set(rideId, ride);

    const joinUrl = `${req.protocol}://${req.get('host')}/rides/${rideId}/join`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl);

    res.status(201).json({ ride, joinUrl, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ride' });
  }
});

// Preview split for a joining user (destination validation + split calculation)
app.post('/rides/:rideId/preview-split', (req, res) => {
  const { rideId } = req.params;
  const { userId, destination } = req.body;
  const ride = rides.get(rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (!ride.isOpen) return res.status(400).json({ error: 'Ride closed' });
  if (!userId || !destination) return res.status(400).json({ error: 'Missing fields' });

  const eligible = isDestinationAlongRoute(destination, ride.start, ride.end);
  if (!eligible) return res.status(400).json({ error: 'Destination not along route' });

  const split = calculateFareSplit(ride, destination);
  res.json({ eligible, split });
});

// Confirm join after preview
app.post('/rides/:rideId/join', (req, res) => {
  const { rideId } = req.params;
  const { userId, destination } = req.body;
  const ride = rides.get(rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (!ride.isOpen) return res.status(400).json({ error: 'Ride closed' });
  if (!userId || !destination) return res.status(400).json({ error: 'Missing fields' });

  const eligible = isDestinationAlongRoute(destination, ride.start, ride.end);
  if (!eligible) return res.status(400).json({ error: 'Destination not along route' });

  const split = calculateFareSplit(ride, destination);
  ride.isOpen = false; // Lock to 2-person share for now
  ride.joiner = { userId, destination, split };
  ride.participants.push(userId);
  rides.set(rideId, ride);

  res.json({ ride });
});

// Complete ride and log payment summary
app.post('/rides/:rideId/complete', (req, res) => {
  const { rideId } = req.params;
  const { paymentMethod } = req.body; // 'wallet' | 'cash'
  const ride = rides.get(rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });

  const summary = ride.joiner?.split
    ? {
        initiator: ride.joiner.split.initiatorShare,
        joiner: ride.joiner.split.newRiderShare,
        total: ride.totalFare,
      }
    : { initiator: ride.totalFare, joiner: 0, total: ride.totalFare };

  ride.completedAt = new Date().toISOString();
  ride.payment = { method: paymentMethod || 'cash', summary };
  rides.set(rideId, ride);
  res.json({ ride, summary });
});

// Simple history endpoints
app.get('/users/:userId/rides', (req, res) => {
  const { userId } = req.params;
  const list = Array.from(rides.values()).filter(r => r.participants.includes(userId));
  res.json({ rides: list });
});

// Ratings
app.post('/rides/:rideId/ratings', (req, res) => {
  const { rideId } = req.params;
  const { userId, rating, feedback } = req.body;
  const ride = rides.get(rideId);
  if (!ride) return res.status(404).json({ error: 'Ride not found' });
  if (!userId || !rating) return res.status(400).json({ error: 'Missing fields' });
  ride.ratings.push({ userId, rating, feedback, at: new Date().toISOString() });
  rides.set(rideId, ride);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
