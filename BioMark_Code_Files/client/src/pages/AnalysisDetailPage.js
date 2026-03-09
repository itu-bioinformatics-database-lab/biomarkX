import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, buildUrl, apiFetch } from '../api';
import { buildBackendUrl } from '../CHANGE_AFTER_DEPLOYMENT';
import UserMenu from '../components/UserMenu';
import AnalysisReport from '../components/step9_AnalysisReport';
import '../css/AnalysisDetailPage.css';
import { LOGIN_PATH } from '../constants/routes';

export default function AnalysisDetailPage() {
  const { analysisId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');
  const [analysisResults, setAnalysisResults] = useState([]);
  const [enrichmentAnalyses, setEnrichmentAnalyses] = useState([]);
  const [biomarkerValidations, setBiomarkerValidations] = useState([]);
  const [continueLoading, setContinueLoading] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');

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

  const handleDownloadFile = async (path) => {
    console.log('Downloading file from path:', path);
    try {
      const url = buildUrl(`/${path}`);
      const response = await apiFetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = path.split('/').pop();
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Error downloading file:', err);
      alert('Failed to download file. Please try again.');
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
        
        // Collect all analyses (parent + children if any)
        const allAnalyses = [analysisData];
        if (analysisData.childAnalyses && analysisData.childAnalyses.length > 0) {
          allAnalyses.push(...analysisData.childAnalyses);
        }
        
        // Collect all images and enrichment analyses from all analyses
        const allImages = [];
        const allEnrichmentAnalyses = [];
        
        for (const singleAnalysis of allAnalyses) {
          const metadata = singleAnalysis.metadata || {};
          
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
              .map((path) => {
                const trimmedPath = path.trim();
                return {
                  id: `img-${singleAnalysis.id}-${trimmedPath}`,
                  path: trimmedPath,
                  caption: trimmedPath.split('/').pop(),
                  analysisId: singleAnalysis.id,
                  classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A'
                };
              });
            allImages.push(...images);
          }
          
          // Collect enrichment analyses
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
                downloadUrl: buildBackendUrl(pathway.resultPath),
                rawPath: pathway.resultPath,
                table: table,
                timestamp: pathway.timestamp,
                analysisId: singleAnalysis.id
              };
            });
            
            const loadedEnrichments = await Promise.all(enrichmentPromises);
            allEnrichmentAnalyses.push(...loadedEnrichments);
          }
        }
        
        // Set combined results
        setAnalysisResults([{
          title: `Analysis Results`,
          images: allImages,
          classPair: 'Combined',
          date: formatDate(analysisData.created_at),
          time: analysisData.metadata?.executionTime || 'N/A',
          types: {
            differential: analysisData.metadata?.analysisMethods?.differential || [],
            clustering: analysisData.metadata?.analysisMethods?.clustering || [],
            classification: analysisData.metadata?.analysisMethods?.classification || []
          },
          parameters: analysisData.metadata
        }]);
        
        setEnrichmentAnalyses(allEnrichmentAnalyses);
        
        // Extract biomarker validation results from all analyses (parent + children)
        const allValidations = [];
        for (const singleAnalysis of allAnalyses) {
          const metadata = singleAnalysis.metadata || {};
          
          // Support both old format (single object) and new format (array)
          if (metadata.biomarkerValidations && Array.isArray(metadata.biomarkerValidations)) {
            allValidations.push(...metadata.biomarkerValidations);
          } else if (metadata.biomarkerValidation) {
            // Legacy support: wrap single validation in array
            allValidations.push(metadata.biomarkerValidation);
          }
        }
        
        setBiomarkerValidations(allValidations);
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

  const handleContinueAnalysis = async () => {
    setContinueLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await api.get(`/api/user/analyses/${analysisId}/continue`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        const { continuationData } = response.data;
        
        // Store continuation data in localStorage to be picked up by App.js
        localStorage.setItem('continuationData', JSON.stringify(continuationData));
        
        // Navigate to home page with a flag to continue
        navigate('/?continue=true');
      }
    } catch (error) {
      console.error('Error loading continuation data:', error);
      alert('Failed to load analysis data. Please try again.');
    } finally {
      setContinueLoading(false);
    }
  };

  const startEditingName = () => {
    setEditingName(true);
    setEditNameValue(analysis.display_name || analysis.filename || '');
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setEditNameValue('');
  };

  const saveDisplayName = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.put(`/api/user/analyses/${analysisId}/display-name`,
        { display_name: editNameValue },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setAnalysis(prev => ({ ...prev, display_name: response.data.analysis.display_name }));
        setEditingName(false);
        setEditNameValue('');
      }
    } catch (err) {
      console.error('Error updating display name:', err);
    }
  };

  const getDisplayName = () => {
    return analysis?.display_name || analysis?.filename || 'Unknown';
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
      <div className="detail-container">
        <div className="detail-action-buttons">
          <button className="back-button" onClick={() => navigate(isGuestUser() ? '/' : '/my-analyses')}>
            &#11013; {isGuestUser() ? 'Back to Home' : 'Back to My Analyses'}
          </button>
        </div>

        <div className="detail-header">
          {editingName ? (
            <div className="analysis-title-edit">
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveDisplayName();
                  if (e.key === 'Escape') cancelEditingName();
                }}
                autoFocus
                placeholder="Enter analysis name..."
                className="analysis-title-input"
                style={{ minWidth: '300px', width: `${Math.max(300, editNameValue.length * 18 + 40)}px` }}
              />
              <button className="title-save-btn" onClick={saveDisplayName} title="Save">✓</button>
              <button className="title-cancel-btn" onClick={cancelEditingName} title="Cancel">✕</button>
            </div>
          ) : (
            <h1>
              <span className="analysis-title-text" onClick={startEditingName} title="Click to rename">
                {getDisplayName()}
              </span>
              {!isGuestUser() && (
                <button className="title-rename-btn" onClick={startEditingName} title="Rename analysis">
                  ✏️
                </button>
              )}
            </h1>
          )}
        </div>

        {/* Analysis Information Card(s) - Show separately for each analysis in group */}
        {(() => {
          const allAnalyses = [analysis];
          if (analysis.childAnalyses && analysis.childAnalyses.length > 0) {
            allAnalyses.push(...analysis.childAnalyses);
          }
          
          return allAnalyses.map((singleAnalysis, index) => {
            const metadata = singleAnalysis.metadata || {};
            const classPair = metadata.selectedClasses && metadata.selectedClasses.length > 0 
              ? metadata.selectedClasses.join(' vs ') 
              : 'N/A';
            
            return (
              <div key={singleAnalysis.id} className="analysis-information-card">
                <h2>
                  Analysis Information
                  {allAnalyses.length > 1 && (
                    <span className="analysis-subtitle"> for {classPair}</span>
                  )}
                </h2>
                
                <div className="info-grid">
                  <div className="info-item">
                    <span className="info-label">File:</span>
                    <span className="info-value">
                      {analysis.filename || (analysis.isMerged ? analysis.sourceFiles?.join(', ') : 'Unknown')}
                    </span>
                  </div>
                  
                  {metadata && (
                    <>
                      <div className="info-item">
                        <span className="info-label">Illness Column:</span>
                        <span className="info-value">{metadata.illnessColumn || 'N/A'}</span>
                      </div>
                      
                      <div className="info-item">
                        <span className="info-label">Sample Column:</span>
                        <span className="info-value">{metadata.sampleColumn || 'N/A'}</span>
                      </div>
                      
                      {metadata.selectedClasses && metadata.selectedClasses.length > 0 && (
                        <div className="info-item">
                          <span className="info-label">Selected Classes:</span>
                          <span className="info-value">{metadata.selectedClasses.join(', ')}</span>
                        </div>
                      )}

                      {metadata.resamplingMethod && (
                        <div className="info-item">
                          <span className="info-label">Class Imbalance Handling:</span>
                          <span className="info-value">
                            {(() => {
                              const method = metadata.resamplingMethod.toUpperCase();
                              const params = metadata.resamplingParams || {};
                              const parts = [];
                              if (method === 'SMOTE') {
                                parts.push(`k_neighbors=${params.k_neighbors ?? 5}`);
                              } else if (method === 'ADASYN') {
                                parts.push(`n_neighbors=${params.n_neighbors ?? 5}`);
                              }
                              if (params.sampling_strategy) {
                                parts.push(`strategy=${params.sampling_strategy}`);
                              }
                              return `${method} applied${parts.length ? ` (${parts.join(', ')})` : ''}`;
                            })()}
                          </span>
                        </div>
                      )}
                      
                      {metadata.analysisMethods && (
                        <>
                          {metadata.analysisMethods.differential?.length > 0 && (
                            <div className="info-item">
                              <span className="info-label">Differential Analysis:</span>
                              <span className="info-value">{metadata.analysisMethods.differential.join(', ')}</span>
                            </div>
                          )}
                          
                          {metadata.analysisMethods.clustering?.length > 0 && (
                            <div className="info-item">
                              <span className="info-label">Clustering:</span>
                              <span className="info-value">{metadata.analysisMethods.clustering.join(', ')}</span>
                            </div>
                          )}
                          
                          {metadata.analysisMethods.classification?.length > 0 && (
                            <div className="info-item">
                              <span className="info-label">Classification:</span>
                              <span className="info-value">{metadata.analysisMethods.classification.join(', ')}</span>
                            </div>
                          )}
                        </>
                      )}
                      
                      {metadata.nonFeatureColumns && metadata.nonFeatureColumns.length > 0 && (
                        <div className="info-item">
                          <span className="info-label">Non-Feature Columns:</span>
                          <span className="info-value">{metadata.nonFeatureColumns.join(', ')}</span>
                        </div>
                      )}
                      
                      {/* Display biomarker summaries */}
                      {metadata.biomarkerSummaries && metadata.biomarkerSummaries.length > 0 && (
                        <div className="info-item full-width">
                          <span className="info-label">Biomarker Summaries:</span>
                          <span className="info-value">
                            {metadata.biomarkerSummaries.length} summary/summaries generated
                            ({metadata.biomarkerSummaries.map(s => s.classPair).join(', ')})
                          </span>
                        </div>
                      )}
                      
                      {/* Display pathway analyses */}
                      {metadata.pathwayAnalyses && metadata.pathwayAnalyses.length > 0 && (
                        <div className="info-item full-width">
                          <span className="info-label">Pathway Analyses:</span>
                          <span className="info-value">
                            {metadata.pathwayAnalyses.length} pathway analysis/analyses completed
                            ({metadata.pathwayAnalyses.map(p => p.displayName).join(', ')})
                          </span>
                        </div>
                      )}
                    </>
                  )}
                  
                  <div className="info-item">
                    <span className="info-label">Status:</span>
                    <span className={`status-badge status-${singleAnalysis.status}`}>
                      {singleAnalysis.status}
                    </span>
                  </div>
                  
                  <div className="info-item">
                    <span className="info-label">Created:</span>
                    <span className="info-value">{formatDate(singleAnalysis.created_at)}</span>
                  </div>

                  {analysis.isMerged && (
                    <div className="info-item">
                      <span className="info-label">Type:</span>
                      <span className="info-value">Merged Analysis</span>
                    </div>
                  )}
                </div>
              </div>
            );
          });
        })()}

        {/* Analysis Results - Split into sections */}
        {(() => {
          // Collect all paths from parent and child analyses
          const allAnalyses = [analysis];
          if (analysis.childAnalyses && analysis.childAnalyses.length > 0) {
            allAnalyses.push(...analysis.childAnalyses);
          }
          
          const allPaths = [];
          allAnalyses.forEach(singleAnalysis => {
            if (singleAnalysis.result_path) {
              const paths = singleAnalysis.result_path.split(',').map(p => p.trim()).filter(p => p);
              allPaths.push(...paths);
            }
          });
          
          if (allPaths.length === 0) return null;
          
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
                            src={buildBackendUrl(path)} 
                            alt={`Biomarker Summary ${index + 1}`}
                            className="result-image"
                          />
                        </div>
                        <div className="result-caption">
                          {path.split('/').pop()}
                        </div>
                        <a 
                          href={buildBackendUrl(path)} 
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
                            href={buildUrl(`/${path}`)}
                            download={path.split('/').pop()}
                            className="download-csv-link"
                            onClick={(e) => {
                              e.preventDefault();
                              handleDownloadFile(path);
                            }}
                        >
                            &#128202; Download: {path.split('/').pop()}
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
                                    src={buildBackendUrl(path)} 
                                  alt={`Result ${index + 1}`}
                                  className="result-image"
                                />
                              </div>
                              <div className="result-caption">
                                {path.split('/').pop()}
                              </div>
                              <a 
                                href={buildBackendUrl(path)} 
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
                                href={buildBackendUrl(path)} 
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
          // Collect all analyses (parent + children)
          const allAnalyses = [analysis];
          if (analysis.childAnalyses && analysis.childAnalyses.length > 0) {
            allAnalyses.push(...analysis.childAnalyses);
          }
          
          // Build separate analysisResults for each analysis for the PDF
          const pdfAnalysisResults = allAnalyses.map((singleAnalysis, index) => {
            const metadata = singleAnalysis.metadata || {};
            
            // Get images for this specific analysis
            let images = [];
            if (singleAnalysis.result_path) {
              const allPaths = singleAnalysis.result_path.split(',');
              images = allPaths
                .filter(path => {
                  const trimmed = path.trim();
                  const isImage = trimmed.match(/\.(png|jpg|jpeg|gif|svg)$/i);
                  const isBiomarker = trimmed.includes('summary_of_statistical_methods');
                  return isImage && !isBiomarker;
                })
                .map((path) => {
                  const trimmedPath = path.trim();
                  return {
                    id: `img-${singleAnalysis.id}-${trimmedPath}`,
                    path: trimmedPath,
                    caption: trimmedPath.split('/').pop()
                  };
                });
            }
            
            return {
              title: `Analysis ${index + 1}`,
              images: images,
              classPair: metadata.selectedClasses ? metadata.selectedClasses.join(' vs ') : 'N/A',
              date: formatDate(singleAnalysis.created_at),
              time: metadata.executionTime || 'N/A',
              types: {
                differential: metadata.analysisMethods?.differential || [],
                clustering: metadata.analysisMethods?.clustering || [],
                classification: metadata.analysisMethods?.classification || []
              },
              parameters: metadata
            };
          });
          
          // Collect all biomarker summaries from all analyses
          const allBiomarkerSummaries = [];
          allAnalyses.forEach(singleAnalysis => {
            const metadata = singleAnalysis.metadata || {};
            if (metadata.biomarkerSummaries && metadata.biomarkerSummaries.length > 0) {
              allBiomarkerSummaries.push(...metadata.biomarkerSummaries.map(summary => ({
                classPair: summary.classPair,
                imagePath: summary.imagePath,
                timestamp: summary.timestamp,
                version: 1,
                featureCount: summary.featureCount || 10,
                aggregationLabel: summary.aggregationLabel || '',
                csvPath: summary.csvPath || null
              })));
            }
          });
          
          // Collect all selected classes from all analyses for the first page
          const allSelectedClasses = allAnalyses.map(a => {
            const meta = a.metadata || {};
            return meta.selectedClasses ? meta.selectedClasses.join(' vs ') : 'N/A';
          });
          
          return (
            <>
              <div className="report-section">
                <AnalysisReport
                  analysisResults={pdfAnalysisResults}
                  analysisDate={formatDate(analysis.created_at)}
                  executionTime={analysis.metadata?.executionTime || 'N/A'}
                  selectedClasses={allSelectedClasses}
                  selectedIllnessColumn={analysis.metadata?.illnessColumn || ''}
                  selectedAnalyzes={[
                    ...(analysis.metadata?.analysisMethods?.differential || []),
                    ...(analysis.metadata?.analysisMethods?.clustering || []),
                    ...(analysis.metadata?.analysisMethods?.classification || [])
                  ]}
                  featureCount={20}
                  summaryImagePath=""
                  summarizeAnalyses={allBiomarkerSummaries}
                  enrichmentAnalyses={enrichmentAnalyses}
                  datasetFileName={analysis.display_name || analysis.filename || 'Unknown'}
                  biomarkerValidationResults={biomarkerValidations}
                  canValidateBiomarkers={false}
                />
              </div>
              
              {/* Continue Analysis Button */}
              <div className="continue-analysis-section" style={{                 marginTop: '4px', 
                padding: '4px', 
                background: '#f8f9fa', 
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <p style={{ 
                  marginBottom: '12px', 
                  fontSize: '15px', 
                  color: '#495057',
                  fontWeight: '500'
                }}>
                  Want to perform additional analyses on this dataset?
                </p>
                <button 
                  className="continue-analysis-button"
                  onClick={handleContinueAnalysis}
                  disabled={continueLoading}
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    border: 'none',
                    padding: '14px 32px',
                    borderRadius: '8px',
                    cursor: continueLoading ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: '600',
                    boxShadow: '0 4px 12px rgba(102, 126, 234, 0.3)',
                    transition: 'all 0.3s ease',
                    opacity: continueLoading ? 0.7 : 1
                  }}
                  onMouseOver={(e) => {
                    if (!continueLoading) {
                      e.target.style.transform = 'translateY(-2px)';
                      e.target.style.boxShadow = '0 6px 16px rgba(102, 126, 234, 0.4)';
                    }
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.3)';
                  }}
                >
                  {continueLoading ? (
                    <>
                      <span className="spinner" style={{
                        display: 'inline-block',
                        width: '16px',
                        height: '16px',
                        border: '2px solid rgba(255, 255, 255, 0.3)',
                        borderTopColor: 'white',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                        marginRight: '8px',
                        verticalAlign: 'middle'
                      }}></span>
                      Loading...
                    </>
                  ) : (
                    <>
                      🔄 Continue on this Analysis
                    </>
                  )}
                </button>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
