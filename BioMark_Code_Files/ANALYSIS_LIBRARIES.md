## Libraries by Analysis Type and Versions

Note: Versions are derived from server/requirements.txt, server/package.json, and client/package.json. Python versions are specified as minimum compatible (>=). Node packages use caret (^) ranges.

### Statistical Tests (ANOVA, t-Test)
- pandas (>=1.5.0)
- numpy (>=1.23.0)
- scikit-learn (>=1.2.0) — f_classif, LabelEncoder, OrdinalEncoder
- scipy (>=1.9.0) — ttest_ind
- seaborn (>=0.12.0)
- matplotlib (>=3.7.0)
Source: modules/statisticalTests/statistical_tests.py

### Feature Ranking Aggregation
- pandas (>=1.5.0)
- numpy (>=1.23.0)
Source: modules/feature_selection.py

### Machine Learning (Classification)
- scikit-learn (>=1.2.0)
- xgboost (>=1.7.0)
- catboost (>=1.2.0)
- pandas (>=1.5.0)
- numpy (>=1.23.0)
Source: modules/machineLearning/classification.py

### Model Explanation
- SHAP
  - shap (>=0.41.0)
  - xgboost (>=1.7.0)
  - scikit-learn (>=1.2.0)
  - pandas (>=1.5.0)
  - numpy (>=1.23.0)
  - seaborn (>=0.12.0)
  - matplotlib (>=3.7.0)
  - tqdm (>=4.64.0)
  Source: modules/modelExplanation/shap_analysis.py
- LIME
  - lime (>=0.2.0)
  - scikit-learn (>=1.2.0)
  - numpy (>=1.23.0)
  - pandas (>=1.5.0)
  - matplotlib (>=3.7.0)
  Source: modules/modelExplanation/lime_analysis.py
- Permutation Feature Importance
  - scikit-learn (>=1.2.0) — permutation_importance
  - pandas (>=1.5.0)
  - numpy (>=1.23.0)
  - seaborn (>=0.12.0)
  - matplotlib (>=3.7.0)
  Source: modules/modelExplanation/feature_importance_analysis.py

### Dimensionality Reduction (PCA, t-SNE, UMAP; 2D/3D)
- scikit-learn (>=1.2.0) — PCA, TSNE, OrdinalEncoder
- umap-learn (>=0.5.3)
- pandas (>=1.5.0)
- numpy (>=1.23.0)
- seaborn (>=0.12.0)
- matplotlib (>=3.7.0)
- plotly (>=5.14.0)
- kaleido (>=0.2.1)
Source: modules/dataVisualization/dimensionality_reduction.py

### Functional Enrichment (g:Profiler)
- requests (>=2.28.0)
- pandas (>=1.5.0)
Source: modules/functionalEnrichment/gProfiler.py

### Statistical Methods Summary Visualization
- pandas (>=1.5.0)
- matplotlib (>=3.7.0)
- seaborn (>=0.12.0)
Source: server/services/summary_of_statiscical_methods.py

### IO and Utilities
- openpyxl (>=3.1.0)
- dill (>=0.3.6)
- requests (>=2.28.0)
- tqdm (>=4.64.0)
- debugpy (>=1.6.0)

### Backend (Node.js v22.21.1 LTS)
- express (^4.21.1)
- cors (^2.8.5)
- multer (^1.4.5-lts.1)
- dotenv (^17.2.3)
- nodemailer (^7.0.9)
- better-sqlite3 (^9.4.0)
- uuid (^9.0.1)

### Frontend (React)
- react (^18.3.1)
- react-dom (^18.3.1)
- react-router-dom (^6.30.1)
- axios (^1.7.7)
- lodash (^4.17.21)
- papaparse (^5.4.1)
- jspdf (^3.0.0)
- html2canvas (^1.4.1)
- html2pdf.js (^0.10.3)
- pdfmake (^0.2.18)
- @mui/material (^7.3.4)
- @mui/icons-material (^7.3.4)
- @emotion/react (^11.14.0)
- @emotion/styled (^11.14.1)
- web-vitals (^2.1.4)
- uuid (^9.0.1)

### Notes
- Actual installed versions may differ depending on the active environment. To capture exact versions, use the environment's package manager outputs (e.g., `pip freeze`, `npm ls --depth=0`).


