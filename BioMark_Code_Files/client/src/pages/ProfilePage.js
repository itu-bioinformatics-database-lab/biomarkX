import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import UserMenu from '../components/UserMenu';
import '../css/ProfilePage.css';
import { LOGIN_PATH } from '../constants/routes';

export default function ProfilePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stats, setStats] = useState({
    totalUploads: 0,
    totalAnalyses: 0,
    accountCreated: ''
  });
  const [userInfo, setUserInfo] = useState({
    username: '',
    email: ''
  });
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (response.data.success) {
        const user = response.data.user;
        setUserInfo({
          username: user.username || '',
          email: user.email || ''
        });
        setFormData({
          username: user.username || '',
          email: user.email || '',
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
      }

      // Fetch user stats (uploads and analyses count)
      const statsResponse = await api.get('/api/user/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (statsResponse.data.success) {
        setStats(statsResponse.data.stats);
      }
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError('Failed to load profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate password change if attempted
    if (formData.newPassword) {
      if (!formData.currentPassword) {
        setError('Current password is required to change password');
        return;
      }
      if (formData.newPassword !== formData.confirmPassword) {
        setError('New passwords do not match');
        return;
      }
    }

    try {
      const token = localStorage.getItem('token');
      const updateData = {
        username: formData.username,
        email: formData.email
      };

      if (formData.newPassword) {
        updateData.currentPassword = formData.currentPassword;
        updateData.newPassword = formData.newPassword;
      }

      const response = await api.put('/auth/update-profile', updateData, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setSuccess('Profile updated successfully!');
        setUserInfo({
          username: formData.username,
          email: formData.email
        });
        setFormData({
          ...formData,
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        });
        setEditMode(false);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    }
  };

  if (loading) {
    return (
      <div className="profile-page">
        <div className="profile-container">
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate(LOGIN_PATH);
  };

  const handleViewGuestAnalysis = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/api/user/guest/last-analysis', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success && response.data.analysis) {
        navigate(`/analysis/${response.data.analysis.id}`);
      } else {
        alert('No analysis found. Please run an analysis first.');
      }
    } catch (error) {
      console.error('Error fetching guest analysis:', error);
      alert('No analysis found or error occurred. Please run an analysis first.');
    }
  };

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

  return (
    <div className="profile-page">
      <header className="app-header">
        <img 
          src={process.env.PUBLIC_URL + "/logo192.png"} 
          alt="Logo" 
          onClick={() => navigate('/')}
          style={{ cursor: 'pointer' }}
        />
        <span>BIOMARK-X: Biomarker Analysis Tool</span>
        <div className="header-buttons">
          <UserMenu 
            isGuest={isGuestUser()}
            username={userInfo.username}
            onNavigateToLogin={() => navigate(LOGIN_PATH)}
            onLogout={handleLogout}
            onViewGuestAnalysis={handleViewGuestAnalysis}
          />
        </div>
      </header>
      <div className="profile-container">
        <div className="profile-header">
          <button className="back-button" onClick={() => navigate('/')}>
            &#11013; Back to Home
          </button>
          <h1>My Profile</h1>
        </div>

        {/* User Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon">&#128193;</div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalUploads}</div>
              <div className="stat-label">Total Uploads</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">&#128202;</div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalAnalyses}</div>
              <div className="stat-label">Analyses Completed</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon">&#128197;</div>
            <div className="stat-info">
              <div className="stat-value">{stats.accountCreated ? new Date(stats.accountCreated).toLocaleDateString('en-GB') : 'N/A'}</div>
              <div className="stat-label">Member Since</div>
            </div>
          </div>
        </div>

        {/* Profile Information */}
        <div className="profile-section">
          <div className="section-header">
            <h2>Account Information</h2>
            {!editMode && (
              <button className="edit-button" onClick={() => setEditMode(true)}>
                Edit Profile
              </button>
            )}
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          {!editMode ? (
            <div className="profile-info">
              <div className="info-row">
                <span className="info-label">Username:</span>
                <span className="info-value">{userInfo.username}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Email:</span>
                <span className="info-value">{userInfo.email}</span>
              </div>
            </div>
          ) : (
            <form onSubmit={handleUpdateProfile} className="profile-form">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  name="username"
                  value={formData.username}
                  onChange={handleInputChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div className="form-divider">Change Password (Optional)</div>

              <div className="form-group">
                <label>Current Password</label>
                <input
                  type="password"
                  name="currentPassword"
                  value={formData.currentPassword}
                  onChange={handleInputChange}
                  placeholder="Required to change password"
                />
              </div>
              <div className="form-group">
                <label>New Password</label>
                <input
                  type="password"
                  name="newPassword"
                  value={formData.newPassword}
                  onChange={handleInputChange}
                  placeholder="Leave blank to keep current"
                />
              </div>
              <div className="form-group">
                <label>Confirm New Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  placeholder="Confirm new password"
                />
              </div>

              <div className="form-actions">
                <button type="button" className="cancel-button" onClick={() => {
                  setEditMode(false);
                  setError('');
                  setFormData({
                    username: userInfo.username,
                    email: userInfo.email,
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: ''
                  });
                }}>
                  Cancel
                </button>
                <button type="submit" className="save-button">
                  Save Changes
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
