import React from 'react';
import '../css/userGuideModal.css';
// Dynamically build backend URL to avoid hard-coded localhost/port
import { buildUrl } from '../api';
import { helpTexts } from '../content/helpTexts';

const UserGuideModal = ({ onClose }) => {
  return (
    <div className="user-guide-overlay">
      <div className="user-guide-modal">
        <div className="popup-header">
          <h2>Biomark - Biomarker Analysis Tool - User Guide</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="popup-content">
          <p className="guide-description">
            This tool enables researchers to explore expression datasets to discover potential biomarkers. Upload your data, configure the analysis pipeline, and generate comprehensive visual and statistical reports in just a few clicks.
          </p>
          <div className="video-container">
            {/* Embedded BioMark tutorial video */}
            <iframe
              src="https://www.youtube.com/embed/CDm9amayNTM?rel=0"
              title="BioMark Tutorial"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>

          {/* Additional tutorial text requested by the user */}
          <div className="guide-steps">
            <p>
              &#10145;&#65039; Access the source code on GitHub:
              {' '}
              <a
                href="https://github.com/itu-bioinformatics-database-lab/biomark"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub Repository
              </a>
            </p>

            <p>
              &#10145;&#65039; Access the analysis report:
              {' '}
              <a
                href={buildUrl('/analysis-report')}
                target="_blank"
                rel="noopener noreferrer"
              >
                Sample Analysis Report
              </a>
            </p>

            <ol className="guide-step-list">
              <li>
                <strong>Step 1: Choose a File or Demo</strong>
                <br />
                Click "Browse" to select your file or use the built‑in option "OR Use a Demo Dataset for Alzheimer's Disease" to try the tool instantly.
                <br />
                Need a template? Open "(Input file format instructions)" and download the sample file from the popup.
              </li>

              <li>
                <strong>Step 2: Upload</strong>
                <br />
                Click "Upload" to send your file. The app shows filename and size. Demo data loads automatically.
              </li>

              <li>
                <strong>Step 3: Select Columns</strong>
                <br />
                Choose "Patient Group" and "Sample ID" using the searchable lists. These cannot be the same.
              </li>

              <li>
                <strong>Step 4: Pick Two Classes</strong>
                <br />
                Review the class distribution chart and select exactly two classes to compare (e.g., AD vs Control). Click "Analyze" to confirm.
              </li>

              <li>
                <strong>Step 5: Choose Analysis and Parameters</strong>
                <br />
                Pick one primary analysis: Statistical Test (T‑test/ANOVA), Dimensionality Reduction (PCA/t‑SNE/UMAP), or Classification (Logistic Regression, Random Forest, XGB, etc.). Optionally add a Model Explanation (SHAP/LIME/Permutation Importance) after selecting a classifier.
                <br />
                Use the "Feature selection stage" toggle to run on "All Features" or on "Selected Top‑N" features derived from earlier runs.
                <br />
                Click "Confirm Selection". Either keep defaults or adjust parameters, then "Use default parameter settings" or "Update Parameter Settings".
              </li>

              <li>
                <strong>Step 6: Exclude Non‑Feature Columns (Optional)</strong>
                <br />
                Add IDs or metadata (e.g., Age) to the exclusion list using the searchable picker.
              </li>

              <li>
                <strong>Step 7: Run Analysis</strong>
                <br />
                Click "Run Analysis". If the run is expected to take long, you can enter an email to get notified when it finishes.
              </li>

              <li>
                <strong>Exploring Results</strong>
                <br />
                Click any figure to zoom and pan. Use "Plot guide" for quick interpretation. Where available, use the links under plots to "Download Model Details as CSV". For tuned classifiers, review "Optimized Hyperparameters (GridSearchCV)" and download as CSV.
              </li>

              <li>
                <strong>Combine Biomarker Lists</strong>
                <br />
                After running at least two biomarker‑producing analyses (e.g., SHAP + ANOVA), set Top‑N and choose an aggregation method, then click "Combine the above biomarker list in to one list". If multiple class pairs exist, select one. A summary heatmap and CSV download will be produced.
              </li>

              <li>
                <strong>Generate Analysis Report</strong>
                <br />
                Click "Generate Analysis Report" to create a publication‑ready PDF. The report groups results by class pairs and includes your summaries and all analysis figures.
              </li>
            </ol>
          </div>
          {/* Glossary and Interpreting Results */}
          <div className="guide-steps">
            <h3>Glossary</h3>
            <ul>
              {helpTexts.glossary.items.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
            <h3 style={{ marginTop: '12px' }}>Interpreting Results</h3>
            <p>{helpTexts.glossary.interpreting}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserGuideModal; 