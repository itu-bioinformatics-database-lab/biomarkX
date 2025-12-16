// Centralized help texts for InfoPanel and HelpTooltip

export const helpTexts = {
  steps: {
    step1: {
      about: "Select a local file or use the demo dataset to get started.",
    },
    step2: {
      about: "Upload your dataset file. Supported formats: CSV/TSV/TXT/XLSX/GZ/ZIP. Large files may take longer.",
      tips: "Ensure headers exist and are consistent. Avoid merged cells. Prefer plain text CSV/TSV for best compatibility.",
    },
    step3: {
      about: "Pick the column that defines your groups and the column that uniquely identifies samples.",
      howTo: "Search by column name. Patient Group and Sample ID cannot be the same.",
    },
    step4: {
      about: "This chart shows the number of samples in each class. Select exactly two classes for comparison.",
      howTo: "Taller bars mean more samples. Large imbalance may affect evaluation; consider robust metrics.",
    },
    step5: {
      about: "Choose one primary analysis. Optionally add a model explanation after selecting a classification method.",
      categories: {
        statisticalTest: "Run T-test/ANOVA to find features that differ between the two selected classes. Reports p-values and a ranked Top-N list (with multiple-testing adjustment).",
        dimensionalityReduction: "Use PCA/t-SNE/UMAP to project data into 2D/3D for inspecting group structure and outliers (labels are only used for coloring, not for fitting).",
        classification: "Train ML models (e.g., Logistic Regression, Random Forest, XGB) to predict class labels; outputs CV/Train/Test metrics (Accuracy, Precision, Recall, F1, ROC-AUC) and key settings.",
        explanation: "Explain model predictions with SHAP/LIME/Permutation importance; provides global feature ranking and per-sample contributions to understand why predictions were made.",
      },
      params: "Default parameters work for most cases. Auto-tuning may significantly increase runtime.",
      methodInfo: {
        // Statistical Tests
        "T-test": "Per feature, compares means between two classes; assumes near-normality; reports a p-value.",
        "Anova": "Per feature, tests mean differences across groups; use adjusted p-values for multiple testing.",
        // Dimensionality Reduction
        "PCA": "Linear projection maximizing variance; shows separation along principal components; sensitive to scaling.",
        "tSNE": "Non-linear embedding preserving local neighborhoods; clusters are illustrative, spacing not absolute; tune perplexity.",
        "UMAP": "Non-linear embedding preserving local+global structure; n_neighbors/min_dist control cluster tightness.",
        // Classification Models
        "Logistic Regression": "Linear decision boundary; interpretable coefficients; works best with standardized features; strong baseline.",
        "Random Forest": "Ensemble of bagged trees; handles non-linearities/outliers; provides feature importance; less tuning sensitive.",
        "XGBClassifier": "Gradient boosting trees; strong accuracy on tabular data; tune learning_rate, depth, estimators.",
        "Decision Tree": "If-else rules; easy to visualize and explain; can overfit without depth/pruning limits.",
        "Gradient Boosting": "Sequential trees correcting previous errors; robust but slower; tune n_estimators and learning_rate.",
        "CatBoosting Classifier": "Boosted trees with ordered categorical handling; good defaults; minimal preprocessing.",
        "AdaBoost Classifier": "Boosts weak learners by reweighting misclassified samples; can be sensitive to noise/outliers.",
        "MLPClassifier": "Feed-forward neural net; captures complex patterns; needs feature scaling and adequate data.",
        "SVC": "Max-margin classifier; kernels enable non-linear boundaries; effective but slower on large datasets; scale features.",
        // Explanation Methods
        "SHAP": "Game-theoretic attribution; quantifies each feature's contribution to predictions (global + per-sample).",
        "LIME": "Fits a simple surrogate around one prediction to show local feature effects; stochastic—repeat for stability.",
        "Permutation-Feature-Importance": "Measures metric drop when a feature is shuffled on holdout/CV; model-agnostic estimate of importance.",
      }
    },
    step6: {
      about: "Exclude identifier or non-informative columns from modeling (e.g., IDs, dates, notes).",
      tips: "Keep numeric, informative features to improve model quality.",
    },
    run: {
      note: "Analysis can take minutes depending on dataset size and selected methods. Please wait…",
    },
    report: {
      about: "Generates a professional PDF report summarizing analyses, grouped by class pairs.",
    },
    combine: {
      note: "Combines biomarker lists from different methods into a single consensus ranking (Top-N).",
      aggregationInfo: (
        "Aggregation methods merge multiple ranked biomarker lists into one consensus list. \n\n" +
        "Common options:\n" +
        "• Reciprocal Rank Fusion (RRF): Robust default. Rewards biomarkers that appear near the top across lists; parameter k controls how quickly lower ranks are discounted.\n" +
        "• Rank Product: Uses the geometric mean of ranks; highlights features consistently near the top; less influenced by a single extreme list.\n" +
        "• Weighted Borda Count: Sums ranks with optional weights; give higher weight to methods you trust more (e.g., SHAP > t-test).\n" +
        "• Simple Sum: Adds ranks across lists equally; easy to interpret but slightly more sensitive to the number of lists and outliers.\n\n" +
        "Tips: Start with RRF as a balanced choice. Use Weighted Borda when you want to prioritize certain methods. Try a couple of options and compare the Top‑N biomarkers for stability."
      ),
    }
  },
  results: {
    general: {
      about: "How to interpret the common plots produced by the analyses.",
      classificationTable: "Interpretation: On imbalanced data prefer F1/Recall over Accuracy. Compare Cross‑Val vs Test to spot overfitting. Higher is better.",
      hyperparams: "Optimized Hyperparameters: Best-found parameter values per model; use them to reproduce results.",
      explanations: "Model Explanations (if selected): SHAP/LIME explain global and per-sample contributions.",
    },
    dimReduction: {
      pca: "Interpretation: Clear separation of class clouds along axes suggests discriminability; heavy overlap indicates weak separation.",
      tsne: "Interpretation: Tight, well‑separated clusters suggest distinct profiles; cluster distances are illustrative, not absolute.",
      umap: "Interpretation: Separated clusters indicate structure; mixing suggests similarity. Neighbor/min_dist settings affect spacing.",
    },
    statistical: {
      heatmap: "Interpretation: Consistent color blocks by class suggest biomarkers; mixed colors indicate weak class signal.",
      volcano: "Interpretation: (if shown) Far right/left and high points are strongest; near center are weak/insignificant.",
      box: "Interpretation: (if shown) Limited overlap between classes suggests stronger difference.",
      topbars: "Interpretation: Higher bars indicate features with stronger group differences; focus on the top candidates.",
    },
    explanation: {
      shapSummary: "Interpretation: Right = pushes prediction higher, left = lowers it; color shows feature value. Greater vertical spread = higher overall importance.",
      shapHeatmap: "Interpretation: Darker magnitude = stronger effect. Similar row patterns mean samples share explanation profiles.",
      shapWaterfall: "Interpretation: Long red bars raise, blue bars lower the prediction; the longest bars drive the decision.",
      shapForce: "Interpretation: Red segments raise, blue lower the output; segment length indicates strength for this sample.",
      limeLocal: "Interpretation: Positive weights support the predicted class; negative oppose it; larger magnitude = stronger influence.",
      permutationImportance: "Interpretation: Bigger metric drop when shuffled means the feature is more important; near‑zero drop suggests low impact.",
    },
    fallback: "This figure summarizes an analysis result. Use the title and caption to interpret the context.",
  },
  glossary: {
    items: [
      "Accuracy/Precision/Recall/F1: Classification metrics; F1 balances precision and recall.",
      "Cross-validation: Average across folds; variability indicates stability.",
      "SHAP/LIME/Permutation Importance: Model-agnostic methods to explain predictions.",
      "p-value (T-test/ANOVA): Lower suggests stronger group difference; adjust for multiple testing.",
    ],
    interpreting: "For classification, focus on F1/Recall when classes are imbalanced and check consistency across folds. Combine statistical significance with model explanations for robust conclusions.",
  },
};

export default helpTexts;


