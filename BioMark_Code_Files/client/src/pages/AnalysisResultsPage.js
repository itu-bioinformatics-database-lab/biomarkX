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

  const handleDownloadReport = async (analysis) => {
    if (!analysis.result_path) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await api.get(`/api/user/analyses/${analysis.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        const analysisData = response.data.analysis;
        
        // Collect all analyses (parent + children if any)
        const allAnalyses = [analysisData];
        if (analysisData.childAnalyses && analysisData.childAnalyses.length > 0) {
          allAnalyses.push(...analysisData.childAnalyses);
        }
        
        // Collect all class pairs from all analyses for filename
        const allClassPairs = [];
        
        // Collect data from all analyses (parent + children)
        const allAnalysisResults = [];
        const allEnrichmentAnalyses = [];
        const allValidations = [];
        const allSummaries = [];
        
        for (const singleAnalysis of allAnalyses) {
          const metadata = singleAnalysis.metadata || {};
          
          // Collect class pair for filename
          if (metadata.selectedClasses && metadata.selectedClasses.length > 0) {
            const classPair = metadata.selectedClasses.join(' vs ');
            if (!allClassPairs.includes(classPair)) {
              allClassPairs.push(classPair);
            }
          }
          
          // Collect images from this analysis
          if (singleAnalysis.result_path) {
            const allPaths = singleAnalysis.result_path.split(',');
            const images = allPaths
              .filter(path => {
                const trimmed = path.trim();
                const isImage = trimmed.match(/\.(png|jpg|jpeg|gif|svg)$/i);
                const isBiomarker = trimmed.includes('summary_of_statistical_methods');
                return isImage && !isBiomarker;
              })
              .map((path) => ({
                id: `img-${singleAnalysis.id}-${path.trim()}`,
                path: path.trim(),
                caption: path.trim().split('/').pop(),
                analysisId: singleAnalysis.id,
                classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A'
              }));
            
            // Add this analysis's results
            allAnalysisResults.push({
              title: `Analysis ${allAnalysisResults.length + 1} for ${metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A'}`,
              images: images,
              classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A',
              date: singleAnalysis.created_at,
              time: metadata.executionTime || 'N/A',
              types: {
                differential: metadata.analysisMethods?.differential || [],
                clustering: metadata.analysisMethods?.clustering || [],
                classification: metadata.analysisMethods?.classification || []
              }
            });
          }
          
          // Collect enrichment analyses
          if (metadata.pathwayAnalyses && metadata.pathwayAnalyses.length > 0) {
            allEnrichmentAnalyses.push(...metadata.pathwayAnalyses);
          }
          
          // Collect summaries
          if (metadata.summaries && metadata.summaries.length > 0) {
            allSummaries.push(...metadata.summaries);
          }
          
          // Collect validations
          if (metadata.biomarkerValidations && Array.isArray(metadata.biomarkerValidations)) {
            allValidations.push(...metadata.biomarkerValidations);
          } else if (metadata.biomarkerValidation) {
            allValidations.push(metadata.biomarkerValidation);
          }
        }
        
        // Get proper filename - just use analysisData.filename directly like AnalysisDetailPage does
        const fileName = analysisData.filename || 'Analysis_Results';
        
        // Set report data to trigger PDF generation
        setReportData({
          analysisResults: allAnalysisResults,
          analysisDate: analysisData.created_at,
          executionTime: analysisData.metadata?.executionTime || 0,
          selectedClasses: allClassPairs,
          selectedIllnessColumn: analysisData.metadata?.illnessColumn || '',
          selectedAnalyzes: analysisData.metadata?.selectedAnalyses || {},
          featureCount: analysisData.metadata?.featureCount || 0,
          summarizeAnalyses: allSummaries,
          enrichmentAnalyses: allEnrichmentAnalyses,
          datasetFileName: fileName,
          biomarkerValidationResult: allValidations.length > 0 ? allValidations : null
        });
      }
    } catch (err) {
      console.error('Error loading analysis for report:', err);
      alert('Failed to generate report. Please try again.');
    }
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
          <span>BIOMARK-X: Biomarker Analysis Tool</span>
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
        <span>BIOMARK-X: Biomarker Analysis Tool</span>
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
                    <button 
                      className="download-button"
                      onClick={() => handleDownloadReport(analysis)}
                      title="Generate and download analysis report"
                    >
                      &#128202; Download Report
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
            datasetFileName={reportData.datasetFileName}
            biomarkerValidationResult={reportData.biomarkerValidationResult}
            canValidateBiomarkers={false}
          />
        </div>
      )}
    </div>
  );
}
