import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, buildUrl } from '../api';
import UserMenu from '../components/UserMenu';
import AnalysisReport from '../components/step9_AnalysisReport';
import '../css/AnalysisDetailPage.css';

export default function AnalysisDetailPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [analysisResults, setAnalysisResults] = useState([]);
  const [enrichmentAnalyses, setEnrichmentAnalyses] = useState([]);

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

  const fetchAnalysisDetail = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.get(`/api/user/analyses/${analysisId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        const analysisData = response.data.analysis;
        setAnalysis(analysisData);
        
        const metadata = analysisData.metadata || {};
        
        // Format the data for the AnalysisReport component
        if (analysisData.result_path) {
          // For PDF generation, only include image files (not CSV files)
          // Also filter out biomarker summary images (top10_biomarkers) to avoid duplication
          const allPaths = analysisData.result_path.split(',');
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
                path: trimmedPath,  // Full path like "results/xxx/shap/png/image.png"
                caption: trimmedPath.split('/').pop()  // Just the filename
              };
            });

          setAnalysisResults([{
            title: `Analysis Results`,
            images: images,
            classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A',
            date: formatDate(analysisData.created_at),
            time: metadata.executionTime || 'N/A',
            types: {
              differential: metadata.analysisMethods?.differential || [],
              clustering: metadata.analysisMethods?.clustering || [],
              classification: metadata.analysisMethods?.classification || []
            },
            parameters: metadata
          }]);
        }

        // Load enrichment analyses with CSV data
        if (metadata.pathwayAnalyses && metadata.pathwayAnalyses.length > 0) {
          const enrichmentPromises = metadata.pathwayAnalyses.map(async (pathway) => {
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
              timestamp: pathway.timestamp
            };
          });
          
          const loadedEnrichmentAnalyses = await Promise.all(enrichmentPromises);
          setEnrichmentAnalyses(loadedEnrichmentAnalyses);
        }
      }
    } catch (err) {
      console.error('Error fetching analysis details:', err);
      setError('Failed to load analysis details');
    } finally {
      setLoading(false);
    }
  }, [analysisId]); // useCallback dependency

  useEffect(() => {
    fetchAnalysisDetail();
    fetchUsername();
  }, [analysisId, fetchAnalysisDetail]);

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    // PostgreSQL returns ISO timestamps, handle both with/without Z suffix
    const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
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
      <div className="analysis-detail-page">
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
        <div className="detail-container">
          <p>Loading analysis details...</p>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="analysis-detail-page">
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
        <div className="detail-container">
          <div className="error-message">{error || 'Analysis not found'}</div>
          <button className="back-button" onClick={() => navigate('/my-analyses')}>
            &#11013; Back to Analyses
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-detail-page">
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
      <div className="detail-container">
        <button className="back-button" onClick={() => navigate(isGuestUser() ? '/' : '/my-analyses')}>
          &#11013; {isGuestUser() ? 'Back to Home' : 'Back to My Analyses'}
        </button>

        <div className="detail-header">
          <h1>Analysis Details</h1>
        </div>

        {/* Analysis Information Card */}
        <div className="analysis-information-card">
          <h2>Analysis Information</h2>
          
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">File:</span>
              <span className="info-value">
                {analysis.filename || (analysis.isMerged ? analysis.sourceFiles?.join(', ') : 'Unknown')}
              </span>
            </div>
            
            {analysis.metadata && (
              <>
                <div className="info-item">
                  <span className="info-label">Illness Column:</span>
                  <span className="info-value">{analysis.metadata.illnessColumn || 'N/A'}</span>
                </div>
                
                <div className="info-item">
                  <span className="info-label">Sample Column:</span>
                  <span className="info-value">{analysis.metadata.sampleColumn || 'N/A'}</span>
                </div>
                
                {analysis.metadata.selectedClasses && analysis.metadata.selectedClasses.length > 0 && (
                  <div className="info-item">
                    <span className="info-label">Selected Classes:</span>
                    <span className="info-value">{analysis.metadata.selectedClasses.join(', ')}</span>
                  </div>
                )}
                
                {analysis.metadata.analysisMethods && (
                  <>
                    {analysis.metadata.analysisMethods.differential?.length > 0 && (
                      <div className="info-item">
                        <span className="info-label">Differential Analysis:</span>
                        <span className="info-value">{analysis.metadata.analysisMethods.differential.join(', ')}</span>
                      </div>
                    )}
                    
                    {analysis.metadata.analysisMethods.clustering?.length > 0 && (
                      <div className="info-item">
                        <span className="info-label">Clustering:</span>
                        <span className="info-value">{analysis.metadata.analysisMethods.clustering.join(', ')}</span>
                      </div>
                    )}
                    
                    {analysis.metadata.analysisMethods.classification?.length > 0 && (
                      <div className="info-item">
                        <span className="info-label">Classification:</span>
                        <span className="info-value">{analysis.metadata.analysisMethods.classification.join(', ')}</span>
                      </div>
                    )}
                  </>
                )}
                
                {analysis.metadata.nonFeatureColumns && analysis.metadata.nonFeatureColumns.length > 0 && (
                  <div className="info-item">
                    <span className="info-label">Non-Feature Columns:</span>
                    <span className="info-value">{analysis.metadata.nonFeatureColumns.join(', ')}</span>
                  </div>
                )}
                
                {/* Display biomarker summaries */}
                {analysis.metadata.biomarkerSummaries && analysis.metadata.biomarkerSummaries.length > 0 && (
                  <div className="info-item full-width">
                    <span className="info-label">Biomarker Summaries:</span>
                    <span className="info-value">
                      {analysis.metadata.biomarkerSummaries.length} summary/summaries generated
                      ({analysis.metadata.biomarkerSummaries.map(s => s.classPair).join(', ')})
                    </span>
                  </div>
                )}
                
                {/* Display pathway analyses */}
                {analysis.metadata.pathwayAnalyses && analysis.metadata.pathwayAnalyses.length > 0 && (
                  <div className="info-item full-width">
                    <span className="info-label">Pathway Analyses:</span>
                    <span className="info-value">
                      {analysis.metadata.pathwayAnalyses.length} pathway analysis/analyses completed
                      ({analysis.metadata.pathwayAnalyses.map(p => p.displayName).join(', ')})
                    </span>
                  </div>
                )}
              </>
            )}
            
            <div className="info-item">
              <span className="info-label">Status:</span>
              <span className={`status-badge status-${analysis.status}`}>
                {analysis.status}
              </span>
            </div>
            
            <div className="info-item">
              <span className="info-label">Created:</span>
              <span className="info-value">{formatDate(analysis.created_at)}</span>
            </div>

            {analysis.isMerged && (
              <div className="info-item">
                <span className="info-label">Type:</span>
                <span className="info-value">Merged Analysis</span>
              </div>
            )}
          </div>
        </div>

        {/* Analysis Results - Split into sections */}
        {analysis.result_path && (() => {
          const allPaths = analysis.result_path.split(',').map(p => p.trim()).filter(p => p);
          
          // Separate paths into categories
          const biomarkerImages = allPaths.filter(p => 
            p.match(/\.(png|jpg|jpeg|gif|svg)$/i) && p.includes('summary_of_statistical_methods')
          );
          const pathwayCSVs = allPaths.filter(p => 
            p.match(/\.(csv)$/i) && (p.includes('kegg') || p.includes('go_'))
          );
          const otherResults = allPaths.filter(p => 
            !p.includes('summary_of_statistical_methods') && 
            !(p.match(/\.(csv)$/i) && (p.includes('kegg') || p.includes('go_')))
          );
          
          return (
            <>
              {/* Statistical Method Results Section */}
              {biomarkerImages.length > 0 && (
                <div className="results-section">
                  <h2>Statistical Method Results</h2>
                  <div className="results-grid">
                    {biomarkerImages.map((path, index) => (
                      <div key={`biomarker-${index}`} className="result-card">
                        <div className="result-image-wrapper">
                          <img 
                            src={`http://localhost:5003/${path}`} 
                            alt={`Biomarker Summary ${index + 1}`}
                            className="result-image"
                          />
                        </div>
                        <div className="result-caption">
                          {path.split('/').pop()}
                        </div>
                        <a 
                          href={`http://localhost:5003/${path}`} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="view-full-link"
                        >
                          View Full Size &#8594;
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Pathway Enrichment Analyses Section */}
              {pathwayCSVs.length > 0 && (
                <div className="results-section">
                  <h2>Pathway Enrichment Analyses</h2>
                  <div className="results-grid">
                    {pathwayCSVs.map((path, index) => (
                      <div key={`pathway-${index}`} className="result-card">
                        <div className="result-file-link">
                          <a 
                            href={`http://localhost:5003/${path}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="download-csv-link"
                          >
                            📊 Download: {path.split('/').pop()}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Other Analysis Results Section */}
              {otherResults.length > 0 && (
                <div className="results-section">
                  <h2>Analysis Results</h2>
                  <div className="results-grid">
                    {otherResults.map((path, index) => {
                      const isImage = path.match(/\.(png|jpg|jpeg|gif|svg)$/i);
                      const isCSV = path.match(/\.(csv)$/i);
                      
                      return (
                        <div key={`other-${index}`} className="result-card">
                          {isImage ? (
                            <>
                              <div className="result-image-wrapper">
                                <img 
                                  src={`http://localhost:5003/${path}`} 
                                  alt={`Result ${index + 1}`}
                                  className="result-image"
                                />
                              </div>
                              <div className="result-caption">
                                {path.split('/').pop()}
                              </div>
                              <a 
                                href={`http://localhost:5003/${path}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="view-full-link"
                              >
                                View Full Size &#8594;
                              </a>
                            </>
                          ) : (
                            <div className="result-file-link">
                              <a 
                                href={`http://localhost:5003/${path}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="download-csv-link"
                              >
                                📊 {isCSV ? 'Download: ' : '📄 '}{path.split('/').pop()}
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          );
        })()}

        {/* Report Generation Section */}
        {analysisResults.length > 0 && (() => {
          // Transform biomarker summaries for AnalysisReport component
          const summarizeAnalyses = (analysis.metadata?.biomarkerSummaries || []).map(summary => ({
            classPair: summary.classPair,
            imagePath: summary.imagePath,
            timestamp: summary.timestamp,
            version: 1,
            featureCount: summary.featureCount || 10,
            aggregationLabel: summary.aggregationLabel || '',
            csvPath: summary.csvPath || null
          }));
          
          return (
            <div className="report-section">
              <AnalysisReport
                analysisResults={analysisResults}
                analysisDate={formatDate(analysis.created_at)}
                executionTime={analysis.metadata?.executionTime || 'N/A'}
                selectedClasses={analysis.metadata?.selectedClasses || []}
                selectedIllnessColumn={analysis.metadata?.illnessColumn || ''}
                selectedAnalyzes={[
                  ...(analysis.metadata?.analysisMethods?.differential || []),
                  ...(analysis.metadata?.analysisMethods?.clustering || []),
                  ...(analysis.metadata?.analysisMethods?.classification || [])
                ]}
                featureCount={20}
                summaryImagePath=""
                summarizeAnalyses={summarizeAnalyses}
                enrichmentAnalyses={enrichmentAnalyses}
                datasetFileName={analysis.filename || 'Unknown'}
              />
            </div>
          );
        })()}
      </div>
    </div>
  );
}
