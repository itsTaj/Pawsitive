import { useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000';

function App() {
  const [initiatorId, setInitiatorId] = useState('user-1');
  const [joinerId, setJoinerId] = useState('user-2');
  const [ride, setRide] = useState(null);
  const [qr, setQr] = useState(null);
  const [createForm, setCreateForm] = useState({
    startLat: 23.7806,
    startLng: 90.4070,
    endLat: 23.7500,
    endLng: 90.3900,
    totalFare: 200,
  });

  const [joinDest, setJoinDest] = useState({ lat: 23.765, lng: 90.40 });
  const [preview, setPreview] = useState(null);

  const createRide = async () => {
    setPreview(null);
    const res = await fetch(`${API_BASE}/rides`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        initiatorId,
        start: { lat: createForm.startLat, lng: createForm.startLng },
        end: { lat: createForm.endLat, lng: createForm.endLng },
        totalFare: Number(createForm.totalFare),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Failed to create ride');
      return;
    }
    setRide(data.ride);
    setQr(data.qrDataUrl);
  };

  const previewSplit = async () => {
    if (!ride) return;
    const res = await fetch(`${API_BASE}/rides/${ride.id}/preview-split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: joinerId, destination: joinDest }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Not eligible');
      return;
    }
    setPreview(data.split);
  };

  const confirmJoin = async () => {
    if (!ride || !preview) return;
    const res = await fetch(`${API_BASE}/rides/${ride.id}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: joinerId, destination: joinDest }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Join failed');
      return;
    }
    setRide(data.ride);
  };

  const completeRide = async () => {
    if (!ride) return;
    const res = await fetch(`${API_BASE}/rides/${ride.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentMethod: 'cash' }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Complete failed');
      return;
    }
    setRide(data.ride);
  };

  return (
    <div style={{ padding: 16, maxWidth: 800, margin: '0 auto' }}>
      <h2>Shared Rickshaw Ride - Demo</h2>
      <section style={{ display: 'grid', gap: 12 }}>
        <div>
          <h3>1) Create Ride (User 1)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <label>Initiator ID
              <input value={initiatorId} onChange={e => setInitiatorId(e.target.value)} />
            </label>
            <label>Total Fare
              <input type="number" value={createForm.totalFare} onChange={e => setCreateForm(f => ({ ...f, totalFare: e.target.value }))} />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <label>Start Lat<input type="number" value={createForm.startLat} onChange={e => setCreateForm(f => ({ ...f, startLat: Number(e.target.value) }))} /></label>
            <label>Start Lng<input type="number" value={createForm.startLng} onChange={e => setCreateForm(f => ({ ...f, startLng: Number(e.target.value) }))} /></label>
            <label>End Lat<input type="number" value={createForm.endLat} onChange={e => setCreateForm(f => ({ ...f, endLat: Number(e.target.value) }))} /></label>
            <label>End Lng<input type="number" value={createForm.endLng} onChange={e => setCreateForm(f => ({ ...f, endLng: Number(e.target.value) }))} /></label>
          </div>
          <button onClick={createRide}>Create Ride & QR</button>
          {qr && (
            <div style={{ marginTop: 8 }}>
              <img src={qr} alt="QR" style={{ width: 160, height: 160 }} />
            </div>
          )}
        </div>

        <div>
          <h3>2) Join (User 2) and Destination</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <label>Joiner ID<input value={joinerId} onChange={e => setJoinerId(e.target.value)} /></label>
            <label>Dest Lat<input type="number" value={joinDest.lat} onChange={e => setJoinDest(d => ({ ...d, lat: Number(e.target.value) }))} /></label>
            <label>Dest Lng<input type="number" value={joinDest.lng} onChange={e => setJoinDest(d => ({ ...d, lng: Number(e.target.value) }))} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={!ride} onClick={previewSplit}>Preview Split</button>
            <button disabled={!ride || !preview} onClick={confirmJoin}>Confirm Join</button>
          </div>
          {preview && (
            <div style={{ marginTop: 8 }}>
              <strong>Split:</strong>
              <div>Initiator: {preview.initiatorShare.toFixed(2)}</div>
              <div>Joiner: {preview.newRiderShare.toFixed(2)}</div>
              <div>Shared meters: {Math.round(preview.sharedMeters)}</div>
            </div>
          )}
        </div>

        <div>
          <h3>3) Complete & Payment</h3>
          <button disabled={!ride} onClick={completeRide}>Complete Ride</button>
          {ride?.payment && (
            <div style={{ marginTop: 8 }}>
              <div><strong>Payment method:</strong> {ride.payment.method}</div>
              <div><strong>Summary:</strong> Initiator {ride.payment.summary.initiator}, Joiner {ride.payment.summary.joiner}</div>
            </div>
          )}
        </div>

        <div>
          <h3>4) History & Ratings</h3>
          <HistoryAndRatings initiatorId={initiatorId} ride={ride} apiBase={API_BASE} />
        </div>
      </section>
    </div>
  );
}

export default App;

function HistoryAndRatings({ initiatorId, ride, apiBase }) {
  const [history, setHistory] = useState([]);
  const [rating, setRating] = useState(5);
  const [feedback, setFeedback] = useState('');

  const load = async () => {
    const res = await fetch(`${apiBase}/users/${initiatorId}/rides`);
    const data = await res.json();
    if (res.ok) setHistory(data.rides);
  };

  useEffect(() => {
    load();
  }, [ride?.id, ride?.completedAt]);

  const submitRating = async (rideId) => {
    const res = await fetch(`${apiBase}/rides/${rideId}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: initiatorId, rating: Number(rating), feedback }),
    });
    if (res.ok) {
      setFeedback('');
      await load();
    }
  };

  return (
    <div>
      <button onClick={load}>Refresh History</button>
      <ul>
        {history.map(r => (
          <li key={r.id} style={{ marginTop: 8 }}>
            <div>
              Ride {r.id.slice(0, 8)} • Fare {r.totalFare} • Participants {r.participants.length}
              {r.completedAt && ' • Completed'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
              <input type="number" min={1} max={5} value={rating} onChange={e => setRating(e.target.value)} style={{ width: 64 }} />
              <input placeholder="feedback" value={feedback} onChange={e => setFeedback(e.target.value)} />
              <button onClick={() => submitRating(r.id)}>Rate</button>
            </div>
            {r.ratings?.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <strong>Ratings:</strong>
                <ul>
                  {r.ratings.map((rt, i) => (
                    <li key={i}>{rt.userId}: {rt.rating} - {rt.feedback}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
