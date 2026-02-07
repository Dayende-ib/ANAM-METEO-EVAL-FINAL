#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Configuration module for ANAM-METEO-EVAL system
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency
    load_dotenv = None

class Config:
    """Configuration class for the system"""
    
    def __init__(self):
        # Project directories
        self.project_root = Path(__file__).resolve().parent.parent
        self._load_env_file()
        self.pdf_directory = self.project_root / "data" / "pdfs"
        self.output_directory = self.project_root / "data" / "output"
        self.temp_directory = self.project_root / "data" / "temp"
        
        # Database configuration
        self.db_path = self.project_root / "data" / "meteo.db"
        
        # API endpoints
        self.llm_api_endpoint = os.getenv("LLM_API_ENDPOINT", "http://localhost:8000/api/translate")
        
        # Roboflow configuration (used for bulletin detections)
        self.roboflow_api_key = os.getenv("ROBOFLOW_API_KEY")
        self.roboflow_model_id = os.getenv("ROBOFLOW_MODEL_ID")
        self.roboflow_api_url = os.getenv("ROBOFLOW_API_URL", "https://detect.roboflow.com")
        self.roboflow_workspace = os.getenv("ROBOFLOW_WORKSPACE")
        self.roboflow_workflow_id = os.getenv("ROBOFLOW_WORKFLOW_ID")
        self.roboflow_workflow_api_url = os.getenv(
            "ROBOFLOW_WORKFLOW_API_URL", "https://serverless.roboflow.com"
        )
        roi_default = self.project_root / "config_roi.json"
        roi_env = os.getenv("ROI_CONFIG_PATH")
        if roi_env:
            roi_path = Path(roi_env)
            if not roi_path.is_absolute():
                roi_path = self.project_root / roi_path
            self.roi_config_path = roi_path
        else:
            self.roi_config_path = roi_default
        
        # Create directories if they don't exist
        self._create_directories()

    def _load_env_file(self):
        """Load root .env when available to populate runtime settings."""
        if load_dotenv is None:
            return
        env_path = self.project_root.parent / ".env"
        if env_path.exists():
            load_dotenv(env_path, override=False)

    def _create_directories(self):
        """Create necessary directories"""
        directories = [
            self.pdf_directory,
            self.output_directory,
            self.temp_directory
        ]
        
        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)
