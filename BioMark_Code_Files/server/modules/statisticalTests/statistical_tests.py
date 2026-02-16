# Load general packages
import pandas as pd
import numpy as np
import os

# Sklearn
from sklearn.preprocessing import LabelEncoder
from sklearn.feature_selection import f_classif
from sklearn import set_config

# Visualization
import seaborn as sns
import matplotlib.pyplot as plt

# Stats
from scipy.stats import ttest_ind, mannwhitneyu, kruskal

# Custom
from modules.logger import logging
from modules.feature_selection import feature_rank


set_config(transform_output="pandas")


class StatisticalTestAnalysis:
    """
    Statistical tests runner for ANOVA, t-Test, Wilcoxon rank-sum, and Kruskal-Wallis. Prepares data the same way as the
    previous DifferentiatingFactorAnalysis and saves results to feature_importances.json
    grouped by class pairs for downstream use (e.g., feature ranking summary).
    """

    def __init__(self,
                 data=None,
                 analyses=None,
                 labels_column: str = "Diagnosis",
                 reference_class: str = "Control",
                 sample_id_column: str = "Sample ID",
                 outdir: str = "output",
                 feature_type: str = "microRNA",
                 top_features_to_plot: int = 20):

        sns.set_theme(style="darkgrid")
        self.data = data

        # Prepare X matrix with categorical preprocessing
        X_temp = data.drop([labels_column, sample_id_column], axis=1)

        categorical_columns = X_temp.select_dtypes(include=['object', 'category']).columns.tolist()
        numerical_columns = X_temp.select_dtypes(include=[np.number]).columns.tolist()

        self.categorical_encoding_info = {}
        if categorical_columns:
            dummies = pd.get_dummies(
                X_temp[categorical_columns],
                columns=categorical_columns,
                prefix=categorical_columns,
                drop_first=False,
                dummy_na=False
            )
            # Store mapping info for frontend/logging
            for col in categorical_columns:
                generated_cols = [c for c in dummies.columns if c.startswith(f"{col}_")]
                self.categorical_encoding_info[col] = {
                    'generated_columns': list(generated_cols),
                    'encoding_type': 'OneHot'
                }
            X_temp = pd.concat([X_temp.drop(columns=categorical_columns), dummies], axis=1)

        self.X = X_temp
        self.y = LabelEncoder().fit_transform(data[labels_column])
        self.feature_map = {feature: f"Feature_{i}" for i, feature in enumerate(self.X.columns)}
        self.feature_map_reverse = {value: key for key, value in self.feature_map.items()}
        self.X.columns = list(map(lambda x: self.feature_map[x], self.X.columns))
        self.labels = data[labels_column]
        self.label_encodings = dict(zip(self.y, self.labels))
        self.class_names = list(self.labels.unique())
        self.reference_class = reference_class
        self.outdir = outdir
        self.feature_type = feature_type
        self.top_features_to_plot = top_features_to_plot
        self.analyses = analyses or ["anova", "t_test"]

        # Seed and random sample indices (kept for compatibility/logs if needed later)
        np.random.seed(42)

        # Prepare output directories
        directories = [term for term in self.analyses]
        for analysis in directories:
            for subdir in ["png", "pdf"]:
                os.makedirs(os.path.join(self.outdir, analysis, subdir), exist_ok=True)

        self.top_features = {}

    def perform_anova(self):
        logging.info("Performing ANOVA Analysis")
        length = 110
        print("=" * length)
        print(" Starting ANOVA")
        print("=" * length)

        f_statistic, p_values = f_classif(self.X, self.y)
        significant_features = pd.DataFrame({
            "Features": list(map(lambda x: self.feature_map_reverse[x], self.X.columns)),
            "F-value": f_statistic,
            "p-value": p_values
        })

        logging.info("Computing ANOVA Features")
        significant_features = significant_features.sort_values(by="F-value", ascending=False).reset_index(drop=True)

        # Save full ANOVA table to CSV for download
        try:
            anova_csv_path = os.path.join(self.outdir, "anova", "anova_results.csv")
            os.makedirs(os.path.dirname(anova_csv_path), exist_ok=True)
            significant_features.to_csv(anova_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting ANOVA Features")
        top_anova_features = significant_features[significant_features["p-value"] < 0.05].head(20)
        colors = top_anova_features['F-value'].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_anova_features['Features'], top_anova_features['F-value'], color=colors)
        plt.xlabel('F-value', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'ANOVA Feature Importance of Top Differentiating {self.feature_type}s', fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/anova/png/anova_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/anova/pdf/anova_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/anova/png/anova_features_plot.png')

        self.top_features["anova"] = {significant_features.Features[i]: significant_features["F-value"][i]
                                       for i in range(len(significant_features))}

        print(sorted(self.top_features["anova"], key=self.top_features["anova"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" ANOVA Analysis Completed ")
        print("=" * length)

    def perform_t_test(self):
        logging.info("Performing T-TEST")
        length = 110
        print("=" * length)
        print(" Starting t-Test")
        print("=" * length)

        if len(self.class_names) != 2:
            logging.warning("t-Test requires exactly two classes; skipping.")
            print("t-Test requires exactly two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        class_0 = self.X.iloc[self.labels[self.labels == self.class_names[0]].dropna().index, :]
        class_1 = self.X.iloc[self.labels[self.labels == self.class_names[1]].dropna().index, :]

        t_test_values = {"Features": [], "statistic": [], "pvalue": [], "df": []}
        for column in self.X.columns:
            output = ttest_ind(class_0[column], class_1[column])
            t_test_values["Features"].append(column)
            t_test_values["pvalue"].append(output.pvalue)
            t_test_values["statistic"].append(output.statistic)
            t_test_values["df"].append(output.df)

        logging.info("Computing Feature Importance by Statistical Significance")
        p_values_df = pd.DataFrame(t_test_values)
        p_values_df["Abs(statistic)"] = p_values_df["statistic"].abs()
        p_values_df = p_values_df.sort_values(by="Abs(statistic)", ascending=False)
        p_values_df["Features"] = p_values_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full t-test table to CSV for download
        try:
            ttest_csv_path = os.path.join(self.outdir, "t_test", "t_test_results.csv")
            os.makedirs(os.path.dirname(ttest_csv_path), exist_ok=True)
            p_values_df.to_csv(ttest_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features")
        top_t_test_features = p_values_df[p_values_df.pvalue < 0.05].head(self.top_features_to_plot)
        colors = top_t_test_features['Abs(statistic)'].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_t_test_features['Features'], top_t_test_features['Abs(statistic)'], color=colors)
        plt.xlabel('Abs(statistic)', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f't-Test Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=25, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/t_test/png/t_test_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/t_test/pdf/t_test_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/t_test/png/t_test_features_plot.png')

        self.top_features["t_test"] = {p_values_df.Features[i]: p_values_df["Abs(statistic)"][i]
                                        for i in range(len(p_values_df))}

        print(sorted(self.top_features["t_test"], key=self.top_features["t_test"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" t-Test Analysis Completed ")
        print("=" * length)

    def perform_wilcoxon_rank_sum(self):
        logging.info("Performing Wilcoxon Rank-Sum Test")
        length = 110
        print("=" * length)
        print(" Starting Wilcoxon Rank-Sum")
        print("=" * length)

        if len(self.class_names) != 2:
            logging.warning("Wilcoxon rank-sum requires exactly two classes; skipping.")
            print("Wilcoxon rank-sum requires exactly two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        class_0 = self.X.iloc[self.labels[self.labels == self.class_names[0]].dropna().index, :]
        class_1 = self.X.iloc[self.labels[self.labels == self.class_names[1]].dropna().index, :]

        wilcoxon_values = {"Features": [], "U statistic": [], "p-value": []}
        for column in self.X.columns:
            output = mannwhitneyu(class_0[column], class_1[column], alternative="two-sided")
            wilcoxon_values["Features"].append(column)
            wilcoxon_values["U statistic"].append(output.statistic)
            wilcoxon_values["p-value"].append(output.pvalue)

        logging.info("Computing Wilcoxon Rank-Sum Features")
        wilcoxon_df = pd.DataFrame(wilcoxon_values)
        wilcoxon_df = wilcoxon_df.sort_values(by="U statistic", ascending=False)
        wilcoxon_df["Features"] = wilcoxon_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full Wilcoxon table to CSV for download
        try:
            wilcoxon_csv_path = os.path.join(self.outdir, "wilcoxon_rank_sum", "wilcoxon_rank_sum_results.csv")
            os.makedirs(os.path.dirname(wilcoxon_csv_path), exist_ok=True)
            wilcoxon_df.to_csv(wilcoxon_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features (Wilcoxon Rank-Sum)")
        top_wilcoxon_features = wilcoxon_df[wilcoxon_df["p-value"] < 0.05].head(self.top_features_to_plot)
        colors = top_wilcoxon_features["U statistic"].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_wilcoxon_features["Features"], top_wilcoxon_features["U statistic"], color=colors)
        plt.xlabel('U statistic', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'Wilcoxon Rank-Sum Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/wilcoxon_rank_sum/png/wilcoxon_rank_sum_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/wilcoxon_rank_sum/pdf/wilcoxon_rank_sum_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/wilcoxon_rank_sum/png/wilcoxon_rank_sum_features_plot.png')

        self.top_features["wilcoxon_rank_sum"] = {wilcoxon_df.Features[i]: wilcoxon_df["U statistic"][i]
                                                   for i in range(len(wilcoxon_df))}

        print(sorted(self.top_features["wilcoxon_rank_sum"], key=self.top_features["wilcoxon_rank_sum"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" Wilcoxon Rank-Sum Analysis Completed ")
        print("=" * length)

    def perform_kruskal_wallis(self):
        logging.info("Performing Kruskal-Wallis Test")
        length = 110
        print("=" * length)
        print(" Starting Kruskal-Wallis")
        print("=" * length)

        if len(self.class_names) < 2:
            logging.warning("Kruskal-Wallis requires at least two classes; skipping.")
            print("Kruskal-Wallis requires at least two classes; skipping.")
            print("=" * length)
            return

        np.random.seed(0)

        group_indices = {
            class_name: self.labels[self.labels == class_name].dropna().index
            for class_name in self.class_names
        }

        kruskal_values = {"Features": [], "H statistic": [], "p-value": []}
        for column in self.X.columns:
            groups = [self.X.loc[group_indices[name], column] for name in self.class_names]
            try:
                output = kruskal(*groups)
                statistic = output.statistic
                p_value = output.pvalue
            except Exception:
                statistic = 0.0
                p_value = 1.0
            kruskal_values["Features"].append(column)
            kruskal_values["H statistic"].append(statistic)
            kruskal_values["p-value"].append(p_value)

        logging.info("Computing Kruskal-Wallis Features")
        kruskal_df = pd.DataFrame(kruskal_values)
        kruskal_df = kruskal_df.sort_values(by="H statistic", ascending=False)
        kruskal_df["Features"] = kruskal_df["Features"].apply(lambda x: self.feature_map_reverse[x])

        # Save full Kruskal-Wallis table to CSV for download
        try:
            kruskal_csv_path = os.path.join(self.outdir, "kruskal_wallis", "kruskal_wallis_results.csv")
            os.makedirs(os.path.dirname(kruskal_csv_path), exist_ok=True)
            kruskal_df.to_csv(kruskal_csv_path, index=False, sep=';', encoding='utf-8-sig')
        except Exception:
            pass

        logging.info("Plotting Top n Features (Kruskal-Wallis)")
        top_kruskal_features = kruskal_df[kruskal_df["p-value"] < 0.05].head(self.top_features_to_plot)
        colors = top_kruskal_features["H statistic"].apply(lambda x: "blue")

        plt.figure(figsize=(10, 15))
        plt.barh(top_kruskal_features["Features"], top_kruskal_features["H statistic"], color=colors)
        plt.xlabel('H statistic', fontsize=20)
        plt.xticks(fontsize=18)
        plt.yticks(fontsize=18)
        plt.title(f'Kruskal-Wallis Feature Importance of Top Differentiating {self.feature_type}s',
                  fontsize=20, loc='center', pad=15)
        plt.gca().invert_yaxis()

        logging.info("Saving Plots")
        plt.savefig(f'{self.outdir}/kruskal_wallis/png/kruskal_wallis_features_plot.png', bbox_inches='tight')
        plt.savefig(f'{self.outdir}/kruskal_wallis/pdf/kruskal_wallis_features_plot.pdf', bbox_inches='tight')
        print(f'{self.outdir}/kruskal_wallis/png/kruskal_wallis_features_plot.png')

        self.top_features["kruskal_wallis"] = {kruskal_df.Features[i]: kruskal_df["H statistic"][i]
                                               for i in range(len(kruskal_df))}

        print(sorted(self.top_features["kruskal_wallis"], key=self.top_features["kruskal_wallis"].get, reverse=True)[:self.top_features_to_plot])
        print("=" * length)
        print(" Kruskal-Wallis Analysis Completed ")
        print("=" * length)

    def run_all_analyses(self):
        logging.info("RUNNING STATISTICAL ANALYSES")
        length = 110
        print("=" * length)
        print(" Starting Statistical Analyses ")
        print("=" * length)

        if "anova" in self.analyses:
            self.perform_anova()
        if "t_test" in self.analyses:
            self.perform_t_test()
        if "wilcoxon_rank_sum" in self.analyses:
            self.perform_wilcoxon_rank_sum()
        if "kruskal_wallis" in self.analyses:
            self.perform_kruskal_wallis()

        # Convert values to float for JSON serialization
        for a in self.top_features.keys():
            for feature in self.top_features[a].keys():
                self.top_features[a][feature] = float(self.top_features[a][feature])

        logging.info("Saving Feature Importances")
        # Save at base results/<file>/feature_importances.json (grouped by class pairs)
        base_outdir = os.path.dirname(self.outdir)
        json_path = os.path.join(base_outdir, "feature_importances.json")

        # Load existing
        import json
        if os.path.exists(json_path):
            with open(json_path, "r") as f:
                try:
                    existing_data = json.load(f)
                except json.JSONDecodeError:
                    existing_data = {}
        else:
            existing_data = {}

        class_pair = "_vs_".join(sorted(str(c) for c in self.class_names))
        if class_pair not in existing_data:
            existing_data[class_pair] = {}

        for a in self.top_features.keys():
            if a not in existing_data[class_pair]:
                existing_data[class_pair][a] = {}
            for feature, value in self.top_features[a].items():
                existing_data[class_pair][a][feature] = float(value)

        with open(json_path, "w") as f:
            json.dump(existing_data, f, indent=4)

        # Generate aggregated ranking CSVs using ONLY current run outputs
        # Structure: { class_pair: { analysis_name: {feature: score} } }
        try:
            filtered_for_ranking = {
                class_pair: {a: self.top_features[a] for a in self.top_features.keys()}
            }
            label_analyses = "+".join(sorted(self.top_features.keys())) if hasattr(self, 'top_features') and self.top_features else ""
            subdir = f"method=statistical_tests{',analysis=' + label_analyses if label_analyses else ''}"
            feature_rank(
                top_features=filtered_for_ranking,
                num_top_features=self.top_features_to_plot,
                feature_type=self.feature_type,
                outdir=base_outdir,
                subdir_label=subdir
            )
        except Exception:
            pass

        print("=" * length)
        print(" Statistical Analyses Completed ")
        print("=" * length)

        # Write a concise README to clarify directory structure for this class pair
        try:
            readme_path = os.path.join(self.outdir, "README.md")
            with open(readme_path, "w", encoding="utf-8") as rf:
                rf.write(
                    "# Analysis Outputs\n\n"
                    "This folder contains statistical analysis outputs for the selected class pair.\n\n"
                    "- feature_ranking/: aggregated ranking CSVs live under `../feature_ranking/<ClassA_ClassB>/ranked_features_df.csv`\n\n"
                    "Notes:\n"
                    "- Aggregated `feature_importances.json` is saved at the parent folder and grouped by model key.\n"
                    "- The canonical ranked features CSV is only under `feature_ranking/<ClassA_ClassB>/`.\n"
                )
        except Exception:
            pass


