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
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState('');
  const [reportData, setReportData] = useState(null);
  const reportTriggerRef = useRef(null);
  const [username, setUsername] = useState('');
  
  // Folder/organization state
  const [selectedFolder, setSelectedFolder] = useState('all'); // 'all', 'favorites', or folder id
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null); // analysis id to delete
  const [showMoveModal, setShowMoveModal] = useState(null); // analysis to move
  const [searchQuery, setSearchQuery] = useState('');
  const [editingFolder, setEditingFolder] = useState(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [folderNameError, setFolderNameError] = useState('');
  const [showDeleteFolderConfirm, setShowDeleteFolderConfirm] = useState(null);
  const [editingAnalysisName, setEditingAnalysisName] = useState(null); // analysis id being renamed
  const [editAnalysisNameValue, setEditAnalysisNameValue] = useState('');

  useEffect(() => {
    fetchAnalyses();
    fetchFolders();
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

  const fetchFolders = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.get('/api/user/folders', {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data.success) {
        setFolders(response.data.folders);
      }
    } catch (err) {
      console.error('Error fetching folders:', err);
      // Folders are optional, don't show error
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    
    // Check for duplicate name
    const isDuplicate = folders.some(
      f => f.name.toLowerCase() === newFolderName.trim().toLowerCase()
    );
    if (isDuplicate) {
      setFolderNameError('A list with this name already exists');
      return;
    }
    
    setFolderNameError('');
    
    try {
      const token = localStorage.getItem('token');
      const response = await api.post('/api/user/folders', 
        { name: newFolderName.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setFolders([...folders, response.data.folder]);
        setNewFolderName('');
        setFolderNameError('');
        setShowNewFolderModal(false);
      }
    } catch (err) {
      console.error('Error creating folder:', err);
      setFolderNameError('Failed to create list');
    }
  };

  const updateFolder = async (folderId, newName) => {
    if (!newName.trim()) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await api.put(`/api/user/folders/${folderId}`, 
        { name: newName.trim() },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setFolders(folders.map(f => f.id === folderId ? { ...f, name: newName.trim() } : f));
        setEditingFolder(null);
        setEditFolderName('');
      }
    } catch (err) {
      console.error('Error updating folder:', err);
      alert('Failed to update folder');
    }
  };

  const deleteFolder = async (folderId) => {
    try {
      const token = localStorage.getItem('token');
      await api.delete(`/api/user/folders/${folderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setFolders(folders.filter(f => f.id !== folderId));
      // Update analyses that were in this folder - remove folder from their folder_ids
      setAnalyses(analyses.map(a => ({
        ...a,
        folder_ids: (a.folder_ids || []).filter(id => id !== folderId)
      })));
      if (selectedFolder === folderId) {
        setSelectedFolder('all');
      }
      setShowDeleteFolderConfirm(null);
    } catch (err) {
      console.error('Error deleting folder:', err);
    }
  };

  const toggleFavorite = async (analysisId, currentStatus) => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.put(`/api/user/analyses/${analysisId}/favorite`, 
        { is_favorite: !currentStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setAnalyses(analyses.map(a => 
          a.id === analysisId ? { ...a, is_favorite: !currentStatus } : a
        ));
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
    }
  };

  const startEditingAnalysisName = (analysis) => {
    setEditingAnalysisName(analysis.id);
    // Use display_name if set, otherwise use the original filename
    setEditAnalysisNameValue(analysis.display_name || analysis.filename || '');
  };

  const cancelEditingAnalysisName = () => {
    setEditingAnalysisName(null);
    setEditAnalysisNameValue('');
  };

  const saveAnalysisName = async (analysisId) => {
    try {
      const token = localStorage.getItem('token');
      const response = await api.put(`/api/user/analyses/${analysisId}/display-name`,
        { display_name: editAnalysisNameValue },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        setAnalyses(analyses.map(a => 
          a.id === analysisId ? { ...a, display_name: response.data.analysis.display_name } : a
        ));
        setEditingAnalysisName(null);
        setEditAnalysisNameValue('');
      }
    } catch (err) {
      console.error('Error updating analysis name:', err);
    }
  };

  const getDisplayName = (analysis) => {
    // Return display_name if set, otherwise fall back to filename
    return analysis.display_name || analysis.filename || 'Unknown File';
  };

  const toggleAnalysisInList = async (analysisId, folderId, isCurrentlyInList) => {
    // Optimistically update UI first
    const currentLists = Array.isArray(showMoveModal?.folder_ids) ? [...showMoveModal.folder_ids] : [];
    let newLists;
    if (isCurrentlyInList) {
      newLists = currentLists.filter(id => id !== folderId);
    } else {
      newLists = [...currentLists, folderId];
    }
    
    // Update UI immediately
    setShowMoveModal(prev => prev ? { ...prev, folder_ids: newLists } : null);
    setAnalyses(prev => prev.map(a => a.id === analysisId ? { ...a, folder_ids: newLists } : a));
    
    try {
      const token = localStorage.getItem('token');
      
      const response = await api.put(`/api/user/analyses/${analysisId}/lists`, 
        { folder_ids: newLists },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!response.data.success) {
        // Revert on failure
        setShowMoveModal(prev => prev ? { ...prev, folder_ids: currentLists } : null);
        setAnalyses(prev => prev.map(a => a.id === analysisId ? { ...a, folder_ids: currentLists } : a));
      }
    } catch (err) {
      console.error('Error updating analysis lists:', err);
      // Revert on error
      const currentLists = Array.isArray(showMoveModal?.folder_ids) ? showMoveModal.folder_ids : [];
      setShowMoveModal(prev => prev ? { ...prev, folder_ids: currentLists } : null);
      setAnalyses(prev => prev.map(a => a.id === analysisId ? { ...a, folder_ids: currentLists } : a));
    }
  };

  const deleteAnalysis = async (analysisId) => {
    try {
      const token = localStorage.getItem('token');
      await api.delete(`/api/user/analyses/${analysisId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Remove from local state (this will also remove children since they're nested)
      setAnalyses(analyses.filter(a => a.id !== analysisId));
      setShowDeleteConfirm(null);
    } catch (err) {
      console.error('Error deleting analysis:', err);
      alert('Failed to delete analysis');
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
        
        // Get proper filename - use display_name if available, otherwise filename
        const fileName = analysisData.display_name || analysisData.filename || 'Analysis_Results';
        
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

  // Filter analyses based on selected folder and search
  const getFilteredAnalyses = () => {
    let filtered = analyses;
    
    // Filter by folder
    if (selectedFolder === 'favorites') {
      filtered = filtered.filter(a => a.is_favorite);
    } else if (selectedFolder !== 'all') {
      filtered = filtered.filter(a => a.folder_ids && a.folder_ids.includes(selectedFolder));
    }
    
    // Filter by search (check display_name, filename, and class names)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(a => 
        (a.display_name && a.display_name.toLowerCase().includes(query)) ||
        (a.filename && a.filename.toLowerCase().includes(query)) ||
        (a.metadata?.selectedClasses && a.metadata.selectedClasses.some(c => c.toLowerCase().includes(query)))
      );
    }
    
    return filtered;
  };

  const getFolderCount = (folderId) => {
    if (folderId === 'all') return analyses.length;
    if (folderId === 'favorites') return analyses.filter(a => a.is_favorite).length;
    return analyses.filter(a => a.folder_ids && a.folder_ids.includes(folderId)).length;
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

  const filteredAnalyses = getFilteredAnalyses();

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
      
      <div className="analysis-page-layout">
        {/* Sidebar */}
        <aside className={`analysis-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
          {sidebarOpen && (
            <>
              <div className="sidebar-header">
                <div className="sidebar-user">
                  <span className="user-avatar">{username ? username.charAt(0).toUpperCase() : '?'}</span>
                  <span className="user-name">{username || 'User'}</span>
                </div>
                <button 
                  className="sidebar-toggle"
                  onClick={() => setSidebarOpen(!sidebarOpen)}
                  title="Collapse sidebar"
                >
                  ◀
                </button>
              </div>
              
              <nav className="sidebar-nav">
                <div className="nav-section">
                  <button 
                    className={`nav-item ${selectedFolder === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedFolder('all')}
                  >
                    <span className="nav-icon">📊</span>
                    <span className="nav-label">All Analyses</span>
                    <span className="nav-count">{getFolderCount('all')}</span>
                  </button>
                  
                  <button 
                    className={`nav-item ${selectedFolder === 'favorites' ? 'active' : ''}`}
                    onClick={() => setSelectedFolder('favorites')}
                  >
                    <span className="nav-icon">⭐</span>
                    <span className="nav-label">Favorites</span>
                    <span className="nav-count">{getFolderCount('favorites')}</span>
                  </button>
                </div>
                
                <div className="nav-section">
                  <div className="nav-section-header">
                    <span>My Lists</span>
                    <button 
                      className="add-folder-btn"
                      onClick={() => setShowNewFolderModal(true)}
                      title="Create new list"
                    >
                      +
                    </button>
                  </div>
                  
                  {folders.length === 0 ? (
                    <p className="no-folders-text">No lists yet</p>
                  ) : (
                    folders.map(folder => (
                      <div key={folder.id} className="folder-item-wrapper" title={`${getFolderCount(folder.id)} analyses`}>
                        {editingFolder === folder.id ? (
                          <div className="folder-edit-form">
                            <input
                              type="text"
                              value={editFolderName}
                              onChange={(e) => setEditFolderName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') updateFolder(folder.id, editFolderName);
                                if (e.key === 'Escape') { setEditingFolder(null); setEditFolderName(''); }
                              }}
                              autoFocus
                            />
                            <button onClick={() => updateFolder(folder.id, editFolderName)}>✓</button>
                            <button onClick={() => { setEditingFolder(null); setEditFolderName(''); }}>✕</button>
                          </div>
                        ) : (
                          <button 
                            className={`nav-item ${selectedFolder === folder.id ? 'active' : ''}`}
                            onClick={() => setSelectedFolder(folder.id)}
                          >
                            <span className="nav-icon">•</span>
                            <span className="nav-label">{folder.name}</span>
                            <span className="nav-count">{getFolderCount(folder.id)}</span>
                          </button>
                        )}
                        {editingFolder !== folder.id && (
                          <div className="folder-actions">
                            <button 
                              className="folder-action-btn"
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                setEditingFolder(folder.id);
                                setEditFolderName(folder.name);
                              }}
                              title="Rename list"
                            >
                              ✎
                            </button>
                            <button 
                              className="folder-action-btn delete"
                              onClick={(e) => { e.stopPropagation(); setShowDeleteFolderConfirm(folder.id); }}
                              title="Delete list"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </nav>
            </>
          )}
          
          {!sidebarOpen && (
            <button 
              className="sidebar-toggle collapsed-toggle"
              onClick={() => setSidebarOpen(true)}
              title="Expand sidebar"
            >
              ▶
            </button>
          )}
        </aside>

        {/* Main Content */}
        <main className="analysis-main-content">
          <div className="analysis-container">
            <div className="analysis-header">
              <button className="back-button" onClick={() => navigate('/')}>
                ◀ Back to Home
              </button>
              <h1>
                {selectedFolder === 'all' ? 'All Analyses' : 
                 selectedFolder === 'favorites' ? 'Favorites' : 
                 folders.find(f => f.id === selectedFolder)?.name || 'List'}
              </h1>
              <p className="subtitle">
                {filteredAnalyses.length} {filteredAnalyses.length === 1 ? 'analysis' : 'analyses'}
                {searchQuery && ` matching "${searchQuery}"`}
              </p>
              
              {/* Search Bar */}
              <div className="search-bar">
                <input
                  type="text"
                  placeholder="Search analyses by filename or class..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="search-input"
                />
                {searchQuery && (
                  <button 
                    className="clear-search"
                    onClick={() => setSearchQuery('')}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            {filteredAnalyses.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  {selectedFolder === 'favorites' ? '★' : searchQuery ? '⌕' : '•'}
                </div>
                <h3>
                  {selectedFolder === 'favorites' 
                    ? 'No favorites yet' 
                    : searchQuery 
                    ? 'No results found'
                    : 'No analyses yet'}
                </h3>
                <p>
                  {selectedFolder === 'favorites'
                    ? 'Star your important analyses to see them here'
                    : searchQuery
                    ? 'Try a different search term'
                    : 'Upload data and run analyses to see your results here'}
                </p>
                {!searchQuery && selectedFolder === 'all' && (
                  <button className="primary-button" onClick={() => navigate('/')}>
                    Start New Analysis
                  </button>
                )}
              </div>
            ) : (
              <div className="analyses-list">
                {filteredAnalyses.map((analysis) => (
                  <div key={analysis.id} className={`analysis-card ${analysis.is_favorite ? 'favorite' : ''}`}>
                    <div className="analysis-card-header">
                      <div className="analysis-main-info">
                        {editingAnalysisName === analysis.id ? (
                          <div className="analysis-name-edit">
                            <input
                              type="text"
                              value={editAnalysisNameValue}
                              onChange={(e) => setEditAnalysisNameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveAnalysisName(analysis.id);
                                if (e.key === 'Escape') cancelEditingAnalysisName();
                              }}
                              autoFocus
                              placeholder="Enter analysis name..."
                              className="analysis-name-input"
                              style={{ minWidth: '200px', width: `${Math.max(200, editAnalysisNameValue.length * 10 + 30)}px` }}
                            />
                            <button 
                              className="name-save-btn"
                              onClick={() => saveAnalysisName(analysis.id)}
                              title="Save"
                            >
                              ✓
                            </button>
                            <button 
                              className="name-cancel-btn"
                              onClick={cancelEditingAnalysisName}
                              title="Cancel"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <h3>
                            <span 
                              className="analysis-name-text"
                              onClick={() => startEditingAnalysisName(analysis)}
                              title="Click to rename"
                            >
                              {getDisplayName(analysis)}
                            </span>
                            <button 
                              className="rename-btn"
                              onClick={() => startEditingAnalysisName(analysis)}
                              title="Rename analysis"
                            >
                              ✏️
                            </button>
                            {analysis.isGroup && (
                              <span className="analysis-count-badge">
                                {analysis.analysisCount} analyses
                              </span>
                            )}
                          </h3>
                        )}
                        <div className="analysis-meta">
                          <span className="analysis-date">{formatDate(analysis.created_at)}</span>
                          {analysis.folder_ids && analysis.folder_ids.length > 0 && (
                            <span className="analysis-folder-tag">
                              {analysis.folder_ids.length === 1 
                                ? folders.find(f => f.id === analysis.folder_ids[0])?.name || 'List'
                                : `${analysis.folder_ids.length} lists`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="analysis-card-actions">
                        <button 
                          className={`favorite-btn ${analysis.is_favorite ? 'active' : ''}`}
                          onClick={() => toggleFavorite(analysis.id, analysis.is_favorite)}
                          title={analysis.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          {analysis.is_favorite ? '★' : '☆'}
                        </button>
                        {getStatusBadge(analysis.status)}
                      </div>
                    </div>
                    {analysis.status === 'failed' && !analysis.result_path && (
                      <div className="analysis-actions">
                        <button
                          className="delete-button"
                          onClick={() => setShowDeleteConfirm(analysis.id)}
                          title="Delete failed analysis"
                        >
                          Delete
                        </button>
                      </div>
                    )}

                    {analysis.result_path && (
                      <div className="analysis-actions">
                        <button 
                          className="view-button"
                          onClick={() => handleViewResults(analysis)}
                        >
                          View Details
                        </button>
                        <button 
                          className="download-button"
                          onClick={() => handleDownloadReport(analysis)}
                          title="Generate and download analysis report"
                        >
                          Download Report
                        </button>
                        <button 
                          className="list-button"
                          onClick={() => setShowMoveModal(analysis)}
                          title="Add to list"
                        >
                          + Add to List
                        </button>
                        <button 
                          className="delete-button"
                          onClick={() => setShowDeleteConfirm(analysis.id)}
                          title="Delete analysis"
                        >
                          Delete
                        </button>
                      </div>
                    )}

                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* New List Modal */}
      {showNewFolderModal && (
        <div className="modal-backdrop" onClick={() => { setShowNewFolderModal(false); setFolderNameError(''); }}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Create New List</h3>
            <p className="modal-desc">Organize your analyses into custom lists</p>
            <input
              type="text"
              placeholder="Enter list name..."
              value={newFolderName}
              onChange={(e) => { setNewFolderName(e.target.value); setFolderNameError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) createFolder();
                if (e.key === 'Escape') { setShowNewFolderModal(false); setFolderNameError(''); }
              }}
              className={`modal-input ${folderNameError ? 'error' : ''}`}
              autoFocus
            />
            {folderNameError && <p className="modal-error">{folderNameError}</p>}
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowNewFolderModal(false)}>
                Cancel
              </button>
              <button 
                className="modal-btn primary" 
                onClick={createFolder} 
                disabled={!newFolderName.trim()}
              >
                Create List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-backdrop" onClick={() => setShowDeleteConfirm(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Delete Analysis?</h3>
            <p className="modal-desc">
              This action cannot be undone. The analysis and all its data will be permanently removed.
              {analyses.find(a => a.id === showDeleteConfirm)?.isGroup && (
                <span className="delete-warning">
                  <br/><strong>Warning:</strong> This will also delete {analyses.find(a => a.id === showDeleteConfirm)?.analysisCount - 1} child analyses.
                </span>
              )}
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowDeleteConfirm(null)}>
                Cancel
              </button>
              <button className="modal-btn danger" onClick={() => deleteAnalysis(showDeleteConfirm)}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to List Panel */}
      {showMoveModal && (
        <div className="modal-backdrop" onClick={() => setShowMoveModal(null)}>
          <div className="modal-box list-modal" onClick={e => e.stopPropagation()}>
            <h3>Add to Lists</h3>
            <p className="modal-desc">Select lists to organize this analysis</p>
            <div className="list-panel-content">
              {folders.length === 0 ? (
                <div className="no-lists-box">
                  <span className="empty-icon">∅</span>
                  <p>No lists yet</p>
                  <button className="modal-btn primary small" onClick={() => { setShowMoveModal(null); setShowNewFolderModal(true); }}>
                    Create First List
                  </button>
                </div>
              ) : (
                folders.map(folder => {
                  const isInList = Array.isArray(showMoveModal.folder_ids) && showMoveModal.folder_ids.includes(folder.id);
                  return (
                    <label key={folder.id} className="list-checkbox">
                      <input 
                        type="checkbox" 
                        checked={isInList}
                        onChange={() => toggleAnalysisInList(showMoveModal.id, folder.id, isInList)}
                      />
                      <span className="checkmark"></span>
                      <span className="list-name">{folder.name}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="modal-actions">
              <button className="modal-btn primary" onClick={() => setShowMoveModal(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Folder Confirmation Modal */}
      {showDeleteFolderConfirm && (
        <div className="modal-backdrop" onClick={() => setShowDeleteFolderConfirm(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3>Delete List?</h3>
            <p className="modal-desc">
              Analyses will be removed from this list but not deleted.
            </p>
            <div className="modal-actions">
              <button className="modal-btn secondary" onClick={() => setShowDeleteFolderConfirm(null)}>
                Cancel
              </button>
              <button className="modal-btn danger" onClick={() => deleteFolder(showDeleteFolderConfirm)}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

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
