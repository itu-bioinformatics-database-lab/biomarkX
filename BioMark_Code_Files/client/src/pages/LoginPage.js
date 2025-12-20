import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import '../css/LoginPage.css';

export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    setError('');
    try {
      const response = await api.post('/auth/login', { email, password, rememberMe });
      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        navigate('/');
      } else {
        setError('Login failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    }
  };

  const handleSignup = async () => {
    setError('');
    if (!username || !email || !password) {
      setError('Please fill in all fields');
      return;
    }
    try {
      const response = await api.post('/auth/signup', { username, email, password, rememberMe });
      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        navigate('/');
      } else {
        setError('Signup failed');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    }
  };

  const handleGuest = async () => {
    try {
      const response = await api.post('/auth/guest');
      if (response.data.token) {
        localStorage.setItem('token', response.data.token);
        // Small delay to ensure token is set before navigation
        setTimeout(() => {
          navigate('/');
        }, 100);
      }
    } catch (err) {
      setError('Guest login failed');
    }
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>BIOMARK-X: Biomarker Analysis Tool</h1>
          <p>{isSignup ? 'Create a new account' : 'Please login to continue'}</p>
        </div>
        
        <div className="login-form">
          {isSignup ? (
            <>
              {/* Signup Form */}
              <input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="login-input"
                autoComplete="username"
              />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                autoComplete="email"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                autoComplete="new-password"
              />
              
              <div className="login-buttons">
                <button onClick={handleSignup} className="signup-btn">
                  Create Account
                </button>
                <button onClick={() => { setIsSignup(false); setError(''); }} className="switch-btn">
                  Already have an account? Login
                </button>
              </div>
            </>
          ) : (
            <>
              {/* Login Form */}
              <input
                type="text"
                placeholder="Email or Username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="login-input"
                autoComplete="username"
              />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="login-input"
                autoComplete="current-password"
              />
              
              <div className="remember-me-container">
                <label>
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span className="remember-me-text">Remember me</span>
                </label>
              </div>
              
              <div className="login-buttons">
                <button onClick={handleLogin} className="login-btn">
                  Login
                </button>
                <button onClick={() => { setIsSignup(true); setError(''); }} className="signup-btn">
                  Create New Account
                </button>
                <button onClick={handleGuest} className="guest-btn">
                  Continue as Guest
                </button>
              </div>
            </>
          )}
          
          {error && <p className="error-message">{error}</p>}
        </div>
      </div>
    </div>
  );
}
