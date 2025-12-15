import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import UserMenu from '../components/UserMenu';
import AnalysisReport from '../components/step9_AnalysisReport';
import '../css/AnalysisResultsPage.css';
import { LOGIN_PATH } from '../constants/routes';

export default function AnalysisResultsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState([]);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState(null);
  const reportTriggerRef = useRef(null);
  const [username, setUsername] = useState('');

  useEffect(() => {
    fetchAnalyses();
    fetchUsername();
  }, []);

  const fetchUsername = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/auth/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.data.success) {
        setUsername(response.data.user.username || '');
      }
    } catch (err) {
      console.error('Error fetching username:', err);
    }
  };

  useEffect(() => {
    // Trigger PDF generation when reportData is set
    if (reportData && reportTriggerRef.current) {
      const btn = reportTriggerRef.current.querySelector('.generate-report-button');
      if (btn) {
        setTimeout(() => btn.click(), 100);
        // Clear reportData after triggering
        setTimeout(() => setReportData(null), 500);
      }
    }
  }, [reportData]);

  const fetchAnalyses = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/api/user/analyses', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setAnalyses(response.data.analyses);
      }
    } catch (err) {
      console.error('Error fetching analyses:', err);
      setError('Failed to load analysis results');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const statusClasses = {
      completed: 'status-completed',
      pending: 'status-pending',
      failed: 'status-failed'
    };

    return (
      <span className={`status-badge ${statusClasses[status] || ''}`}>
        {status || 'unknown'}
      </span>
    );
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // PostgreSQL returns ISO timestamps, handle both with/without Z suffix
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleString('en-GB');
  };

  const handleViewResults = (analysis) => {
    if (!analysis.result_path) return;
    
    // Navigate to a dedicated results page with the analysis ID
    navigate(`/analysis/${analysis.id}`);
  };

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

  if (loading) {
    return (
      <div className="analysis-results-page">
        <header className="app-header">
          <img 
            src={process.env.PUBLIC_URL + "/logo192.png"} 
            alt="Logo" 
            onClick={() => navigate('/')}
            style={{ cursor: 'pointer' }}
          />
          <span>BIOMARKER ANALYSIS TOOL</span>
          <div className="header-buttons">
            <UserMenu 
              isGuest={isGuestUser()}
              username={username}
              onNavigateToLogin={() => navigate(LOGIN_PATH)}
              onLogout={handleLogout}
              onViewGuestAnalysis={handleViewGuestAnalysis}
            />
          </div>
        </header>
        <div className="analysis-container">
          <p>Loading analyses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-results-page">
      <header className="app-header">
        <img 
          src={process.env.PUBLIC_URL + "/logo192.png"} 
          alt="Logo" 
          onClick={() => navigate('/')}
          style={{ cursor: 'pointer' }}
        />
        <span>BIOMARKER ANALYSIS TOOL</span>
        <div className="header-buttons">
          <UserMenu 
            isGuest={isGuestUser()}
            username={username}
            onNavigateToLogin={() => navigate(LOGIN_PATH)}
            onLogout={handleLogout}
            onViewGuestAnalysis={handleViewGuestAnalysis}
          />
        </div>
      </header>
      <div className="analysis-container">
        <div className="analysis-header">
          <button className="back-button" onClick={() => navigate('/')}>
            &#11013; Back to Home
          </button>
          <h1>My Analysis Results</h1>
          <p className="subtitle">View and manage your analysis history</p>
        </div>

        {error && <div className="error-message">{error}</div>}

        {analyses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#129335;</div>
            <h3>No analyses yet</h3>
            <p>Upload data and run analyses to see your results here</p>
            <button className="primary-button" onClick={() => navigate('/')}>
              Start New Analysis
            </button>
          </div>
        ) : (
          <div className="analyses-list">
            {analyses.map((analysis) => (
              <div key={analysis.id} className="analysis-card">
                <div className="analysis-card-header">
                  <div className="analysis-main-info">
                    <h3>
                      {analysis.filename || 'Unknown File'}
                      {analysis.isGroup && (
                        <span className="analysis-count-badge">
                          {analysis.analysisCount} analyses
                        </span>
                      )}
                    </h3>
                    <div className="analysis-meta">
                      <span className="analysis-date">{formatDate(analysis.created_at)}</span>
                    </div>
                  </div>
                  {getStatusBadge(analysis.status)}
                </div>

                {analysis.result_path && (
                  <div className="analysis-actions">
                    <button 
                      className="view-button"
                      onClick={() => handleViewResults(analysis)}
                    >
                      &#128270; View Details
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hidden AnalysisReport component for PDF generation */}
      {reportData && (
        <div style={{ position: 'absolute', left: '-9999px' }} ref={reportTriggerRef}>
          <AnalysisReport
            analysisResults={reportData.analysisResults}
            analysisDate={reportData.analysisDate}
            executionTime={reportData.executionTime}
            selectedClasses={reportData.selectedClasses}
            selectedIllnessColumn={reportData.selectedIllnessColumn}
            selectedAnalyzes={reportData.selectedAnalyzes}
            featureCount={reportData.featureCount}
            summaryImagePath=""
            summarizeAnalyses={reportData.summarizeAnalyses || []}
            enrichmentAnalyses={reportData.enrichmentAnalyses || []}
            datasetFileName={reportData.filename}
            biomarkerValidationResult={reportData.biomarkerValidationResult}
            canValidateBiomarkers={false}
          />
        </div>
      )}
    </div>
  );
}
