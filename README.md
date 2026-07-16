# BioMark: A Web-Based Biomarker Analysis Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

BioMark is a user-friendly, web-based platform designed to streamline biomarker discovery and analysis from high-dimensional omics data. It aims to empower researchers, especially those without extensive computational expertise, to perform complex analyses such as differential analysis, clustering, and classification with just a few clicks.

---

## 🚀 Quick Links

* **🖥️ Live Tool:** [**https://bioinfomics.itu.edu.tr/biomarkX**](https://bioinfomics.itu.edu.tr/biomarkX)
* **🎥 Video Tutorial:** [**Watch the full tutorial on YouTube**](https://www.youtube.com/watch?v=CDm9amayNTM)
* **📄 Sample Analysis Report:** [**View the Sample Analysis Report (Biomarker_Sample_Analysis_Report.pdf)**](./Biomarker_Sample_Analysis_Report.pdf)


## ✨ Key Features

* **No-Code Interface:** Perform advanced analyses entirely through an intuitive web interface.
* **Multiple Analysis Methods:** Supports statistical tests (ANOVA, t-test) and machine learning explainability methods (SHAP, LIME).
* **Consolidated Ranking:** A unique feature to combine and rank biomarker lists from multiple methods for more robust findings.
* **Interactive Visualizations:** Instantly generate PCA, t-SNE, UMAP plots, heatmaps, and various SHAP plots.
* **Automated Reporting:** Download a comprehensive PDF report of your entire analysis workflow.

## 🚀 Getting Started

This repository contains the source code for the frontend and backend components of BioMark-X.

### 1. Prerequisites
Before running the application, ensure you have the following installed on your system:
* **Docker & Docker Desktop** (Make sure the Docker engine is running)
* **PostgreSQL** (Running locally on your machine)

### 2. Database Setup
1. Open your local PostgreSQL server (e.g., via pgAdmin or psql).
2. Create a new empty database for the project (e.g., `biomark_db`).
3. Note your PostgreSQL username and password, you will need them for the environment variables.

**Redis Setup:**
Ensure a Redis server is running on your machine (default port `6379`). 
*Tip: If you have Docker installed, the easiest way to start a Redis server is by running this command in your terminal:*
```bash
docker run -d -p 6379:6379 --name biomark-redis redis
```

### 3. Environment Variables (.env)
You need to set environment variables manually.

1. Navigate to the `BioMark_Code_Files/server` directory.
2. Create a file named `.env` (You can use the provided `.env.example` as a template).
3. Fill in your local database credentials. **Important:** Since the backend runs inside a Docker container, you must use `host.docker.internal` instead of `localhost` or `127.0.0.1` for the database host (for Windows and Mac users).

Example backend `.env`:
DB_HOST=host.docker.internal
DB_PORT=5432
DB_NAME=biomark_db
DB_USER=your_postgres_username
DB_PASSWORD=your_postgres_password

### 4. Running the Application
Once the database and environment variables are ready, you can start the application using Docker Compose:

1. Clone the repository
2. Open a terminal in the root directory of the project (where `docker-compose.yml` is located).
3. Run the following command:
   ```bash
   docker-compose up --build
   ```
4. Once the build is complete and the containers are running, open your browser and navigate to:
http://localhost:3000/biomark

## ✍️ Citation

If you use BioMark in your research, please cite our work.

...
## 📝 License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
