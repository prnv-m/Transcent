// frontend/src/pages/HomePage.jsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidV4 } from 'uuid'; // For generating unique room IDs

function HomePage() {
  const [joinRoomId, setJoinRoomId] = useState('');
  const navigate = useNavigate();

  const handleCreateMeeting = () => {
    const newRoomId = uuidV4();
    navigate(`/room/${newRoomId}`);
  };

  const handleJoinMeeting = (e) => {
    e.preventDefault();
    if (joinRoomId.trim()) {
      navigate(`/room/${joinRoomId.trim()}`);
    }
  };

  return (
    <div>
      <h1>Welcome to Transcent</h1>
      <button onClick={handleCreateMeeting}>Create New Meeting</button>
      <hr />
      <form onSubmit={handleJoinMeeting}>
        <input
          type="text"
          placeholder="Enter Room ID to Join"
          value={joinRoomId}
          onChange={(e) => setJoinRoomId(e.target.value)}
        />
        <button type="submit">Join Meeting</button>
      </form>
    </div>
  );
}
export default HomePage;