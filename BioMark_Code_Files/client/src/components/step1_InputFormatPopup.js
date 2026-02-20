import React from 'react';
import '../css/step1_InputFormatPopup.css';
import { buildUrl } from '../api';
import { apiFetch } from '../api';

const InputFormatPopup = ({ onClose }) => {
  // Handles downloading the demo file from the server
  const handleDownloadDemo = () => {
    apiFetch(buildUrl('/download-demo-file'))
      .then(response => response.blob())
      .then(blob => {
        // Create a link to download the file
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "GSE120584_serum_norm_demo.csv";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      })
      .catch(error => console.error('Error downloading demo file:', error));
  };

  return (
    // Overlay for the popup
    <div className="input-format-popup-overlay">
      {/* Main popup container */}
      <div className="input-format-popup">
        {/* Popup header with title and close button */}
        <div className="popup-header">
          <h2>Input File Format Instructions</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        
        {/* Popup content section */}
        <div className="popup-content">
          {/* Instructions for the required file format */}
          <div className="format-instructions">
            <h3>Required Format</h3>
            <p>Your input file may be CSV, TSV, TXT, XLSX or their compressed (.gz / .zip) versions and should meet the following criteria:</p>
            <ul>
              <li>First row must contain column headers</li>
              <li>Must include a column for sample IDs</li>
              <li>Must include a column for illness/condition labels</li>
              <li>Remaining columns should be feature values (e.g., miRNA expressions)</li>
              <li>No missing values allowed in the feature columns</li>
              <li>Numeric values should use period (.) as decimal separator</li>
            </ul>
            
            <h3>Example Format</h3>
            {/* Example of a properly formatted CSV file */}
            <pre className="file-format-example">
              Sample_ID,Illness,miRNA_1,miRNA_2,miRNA_3,... <br />
              Sample1,Control,0.123,4.567,0.891,... <br />
              Sample2,Alzheimer,0.234,5.678,0.912,... <br />
              Sample3,Control,0.345,6.789,0.123,... <br />
            </pre>
          </div>
          
          {/* Section for demo file download and screenshot preview */}
          <div className="demo-file-section">
            <h3>Demo File</h3>
            <p>You can download our demo file to see the exact format required:</p>
            <button 
              className="download-demo-button" 
              onClick={handleDownloadDemo}
            >
              Download Demo File
            </button>
            
            <div className="screenshot-container">
              <h4>Sample File Preview:</h4>
              {/* Screenshot image of the sample file */}
              <img 
                src={process.env.PUBLIC_URL + "/demo-file-screenshot.png"} 
                alt="Sample file format screenshot" 
                className="demo-screenshot"
              />
              <p className="screenshot-caption">Example of a properly formatted input file</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InputFormatPopup; 