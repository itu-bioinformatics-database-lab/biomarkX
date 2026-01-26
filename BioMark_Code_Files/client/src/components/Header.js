import React from 'react';
import { useNavigate } from 'react-router-dom';
import UserMenu from './UserMenu';
import '../css/Header.css';
import { LOGIN_PATH } from '../constants/routes';

export default function Header({ onOpenUserGuide, onLogout, username, onViewGuestAnalysis }) {
  const navigate = useNavigate();

  const isGuestUser = () => {
    const token = localStorage.getItem('token');
    if (!token) return true;
    
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      
      const payload = JSON.parse(atob(parts[1]));
      return payload.isGuest === true;
    } catch (e) {
      return true;
    }
  };

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      localStorage.removeItem('token');
      navigate(LOGIN_PATH);
    }
  };

  const handleViewGuestAnalysis = () => {
    if (onViewGuestAnalysis) {
      onViewGuestAnalysis();
    }
  };

  return (
    <header className="app-header">
      <img src={process.env.PUBLIC_URL + "/logo192.png"} alt="Logo" />
      <span>BIOMARK-X: Biomarker Analysis Tool</span>
      
      <div className="header-buttons">
        <UserMenu 
          isGuest={isGuestUser()}
          username={username}
          onNavigateToLogin={() => navigate(LOGIN_PATH)}
          onLogout={handleLogout}
          onViewGuestAnalysis={handleViewGuestAnalysis}
        />

        {onOpenUserGuide && (
          <button className="user-guide-link" onClick={onOpenUserGuide}>
            <span>User</span>
            <span>Guide</span>
          </button>
        )}
      </div>
    </header>
  );
}
