import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, buildUrl } from '../api';
import UserMenu from '../components/UserMenu';
import AnalysisReport from '../components/step9_AnalysisReport';
import '../css/AnalysisResultsPage.css';

export default function AnalysisResultsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState([]);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState(null);
  const reportTriggerRef = useRef(null);
  const [username, setUsername] = useState('');

  // Function to fetch and parse CSV data for enrichment analyses
  const fetchEnrichmentResultTable = async (relativePath) => {
    if (!relativePath) return null;
    try {
      const url = buildUrl(`/${relativePath}`);
      const response = await fetch(url);
      if (!response.ok) return null;
      
      const rawText = (await response.text()).replace(/^\uFEFF/, '').trim();
      if (!rawText) return null;
      
      const lines = rawText.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) return null;
      
      const delimiter = [';', '\t', ','].find((del) => lines[0].includes(del)) || ',';
      const cleanCell = (value) => value.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
      const headers = lines[0].split(delimiter).map(cleanCell);
      const rows = lines.slice(1).map((line) => line.split(delimiter).map(cleanCell));
      
      if (headers.length === 0 || rows.length === 0) {
        return { headers, rows: [] };
      }
      return { headers, rows, delimiter };
    } catch (err) {
      console.warn('Failed to load enrichment table:', err);
      return null;
    }
  };

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
    // The database stores UTC time, convert to user's local timezone
    const date = new Date(dateString + 'Z'); // Add 'Z' to indicate UTC
    return date.toLocaleString('en-GB');
  };

  const handleViewResults = (analysis) => {
    if (!analysis.result_path) return;
    
    // Navigate to a dedicated results page with the analysis ID
    navigate(`/analysis/${analysis.id}`);
  };

  const handleDownloadReport = async (analysis) => {
    if (!analysis.result_path) return;
    
    try {
      // Fetch full analysis data including metadata
      const token = localStorage.getItem('token');
      const response = await api.get(`/api/user/analyses/${analysis.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!response.data.success) return;

      const fullAnalysis = response.data.analysis;
      const metadata = fullAnalysis.metadata || {};

      // Prepare report data from the analysis with proper metadata
      // For PDF generation, only include image files (not CSV files)
      // Also filter out biomarker summary images (top10_biomarkers) to avoid duplication
      const allPaths = fullAnalysis.result_path.split(',');
      const images = allPaths
        .filter(path => {
          const trimmed = path.trim();
          const isImage = trimmed.match(/\.(png|jpg|jpeg|gif|svg)$/i);
          const isBiomarker = trimmed.includes('summary_of_statistical_methods');
          // Include only image files that are NOT biomarker summaries
          return isImage && !isBiomarker;
        })
        .map((path, index) => {
          const trimmedPath = path.trim();
          return {
            id: `img-${index}`,
            path: trimmedPath,
            caption: trimmedPath.split('/').pop()
          };
        });

      const analysisResults = [{
        title: `Analysis Results`,
        images: images,
        classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A',
        date: formatDate(fullAnalysis.created_at),
        time: metadata.executionTime || 'N/A',
        types: {
          differential: metadata.analysisMethods?.differential || [],
          clustering: metadata.analysisMethods?.clustering || [],
          classification: metadata.analysisMethods?.classification || []
        },
        parameters: metadata
      }];

      // Extract biomarker summaries and pathway analyses from metadata
      const biomarkerSummaries = metadata.biomarkerSummaries || [];
      const pathwayAnalyses = metadata.pathwayAnalyses || [];
      
      // Transform biomarkerSummaries to summarizeAnalyses format expected by AnalysisReport
      const summarizeAnalyses = biomarkerSummaries.map(summary => ({
        classPair: summary.classPair,
        imagePath: summary.imagePath,
        timestamp: summary.timestamp,
        featureCount: summary.featureCount,
        aggregationLabel: summary.aggregationLabel || '',
        csvPath: summary.csvPath
      }));
      
      // Transform pathwayAnalyses to enrichmentAnalyses format - load CSV data
      const enrichmentPromises = pathwayAnalyses.map(async (pathway) => {
        const table = await fetchEnrichmentResultTable(pathway.resultPath);
        return {
          analysisType: pathway.type,
          analysisDisplayName: pathway.displayName,
          geneSet: pathway.geneSet || '',
          summary: pathway.summary || '',
          significantPathwayCount: pathway.significantPathwayCount || 0,
          totalPathways: pathway.totalPathways || 0,
          inputGeneCount: pathway.inputGeneCount || 0,
          downloadUrl: `http://localhost:5003/${pathway.resultPath}`,
          rawPath: pathway.resultPath,
          table: table, // Loaded CSV table data
        };
      });
      
      const enrichmentAnalyses = await Promise.all(enrichmentPromises);
      
      setReportData({
        analysisResults,
        analysisDate: formatDate(fullAnalysis.created_at),
        executionTime: metadata.executionTime || 'N/A',
        filename: fullAnalysis.filename || 'Unknown',
        selectedClasses: metadata.selectedClasses || [],
        selectedIllnessColumn: metadata.illnessColumn || '',
        selectedAnalyzes: [
          ...(metadata.analysisMethods?.differential || []),
          ...(metadata.analysisMethods?.clustering || []),
          ...(metadata.analysisMethods?.classification || [])
        ],
        featureCount: 20,
        nonFeatureColumns: metadata.nonFeatureColumns || [],
        summarizeAnalyses,
        enrichmentAnalyses
      });
    } catch (err) {
      console.error('Error preparing report:', err);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
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
              onNavigateToLogin={() => navigate('/login')}
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
            onNavigateToLogin={() => navigate('/login')}
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
                    <h3>{analysis.filename || 'Unknown File'}</h3>
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
                    >
                      &#128229; Download Report
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
          />
        </div>
      )}
    </div>
  );
}
