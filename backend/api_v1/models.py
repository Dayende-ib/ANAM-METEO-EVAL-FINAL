from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field

class StationData(BaseModel):
    name: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    tmin_obs: Optional[float] = None
    tmax_obs: Optional[float] = None
    weather_obs: Optional[str] = None
    tmin_prev: Optional[float] = None
    tmax_prev: Optional[float] = None
    weather_prev: Optional[str] = None
    interpretation_francais: Optional[str] = None
    interpretation_moore: Optional[str] = None
    interpretation_dioula: Optional[str] = None
    quality_score: Optional[float] = None


class BulletinData(BaseModel):
    date_bulletin: str
    type: Optional[str] = None
    stations: List[StationData]
    interpretation_francais: Optional[str] = None
    interpretation_moore: Optional[str] = None
    interpretation_dioula: Optional[str] = None


class BulletinSummary(BaseModel):
    date: str = Field(..., example="2025-10-15")
    type: str = Field(..., example="observation")
    pages: int = Field(..., example=1)


class BulletinsPage(BaseModel):
    items: List[BulletinSummary]
    total: int
    limit: int
    offset: int

    class Config:
        json_schema_extra = {
            "example": {
                "items": [
                    {"date": "2025-10-15", "type": "observation", "pages": 1},
                    {"date": "2025-10-15", "type": "forecast", "pages": 1},
                ],
                "total": 2,
                "limit": 50,
                "offset": 0,
            }
        }


class EvaluationMetrics(BaseModel):
    date: str
    forecast_reference_date: str
    mae_tmin: Optional[float]
    mae_tmax: Optional[float]
    rmse_tmin: Optional[float]
    rmse_tmax: Optional[float]
    bias_tmin: Optional[float]
    bias_tmax: Optional[float]
    accuracy_weather: Optional[float]
    precision_weather: Optional[float]
    recall_weather: Optional[float]
    f1_score_weather: Optional[float]
    confusion_matrix: Optional[dict]
    sample_size: Optional[int]


class MetricsListResponse(BaseModel):
    items: List[EvaluationMetrics]
    total: int


class ScrapeRequest(BaseModel):
    use_pagination: bool = True
    year: Optional[int] = Field(None, description="Year to filter bulletins")
    month: Optional[int] = Field(None, description="Month (1-12) to filter bulletins")
    day: Optional[int] = Field(None, description="Day (1-31) to filter bulletins")
    max_pages: Optional[int] = Field(None, ge=1, description="Number of pages to crawl")
    max_bulletins: Optional[int] = Field(None, ge=1, description="Limit of bulletins to download")
    delay: float = Field(1.0, ge=0, description="Delay between downloads")
    output_dir: Optional[str] = Field(None, description="Custom output directory for PDFs")
    max_size_mb: Optional[int] = Field(None, ge=1, description="Max PDF size in MB")
    retries: Optional[int] = Field(None, ge=0, description="Retry count for network requests")
    backoff: Optional[float] = Field(None, ge=0, description="Backoff factor between retries")
    connect_timeout: Optional[float] = Field(None, ge=1, description="Connection timeout in seconds")
    read_timeout: Optional[float] = Field(None, ge=1, description="Read timeout in seconds")
    verify_ssl: Optional[bool] = Field(None, description="Verify SSL certificates")


class ScrapeResponse(BaseModel):
    total: int
    success: int
    skipped: int = 0
    failed: int
    downloads: List[dict]
    errors: List[dict] = Field(default_factory=list)
    output_dir: str


class ScrapeManifestResponse(BaseModel):
    output_dir: str
    exists: bool
    manifest: Dict[str, Any]


class UploadResponse(BaseModel):
    filename: str
    pdf_path: str
    temperatures: List[Any]


class UploadJobResponse(BaseModel):
    job_id: str
    status: str
    filename: Optional[str] = None
    pdf_path: Optional[str] = None


class UploadJobStatus(BaseModel):
    job_id: str
    status: str
    filename: Optional[str] = None
    pdf_path: Optional[str] = None
    result: Optional[UploadResponse] = None
    error_message: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class UploadBatchResponse(BaseModel):
    batch_id: str
    total: int
    jobs: List[UploadJobResponse]


class UploadBatchStatus(BaseModel):
    batch_id: str
    status: str
    total: int
    pending: int
    running: int
    success: int
    error: int
    canceled: int
    jobs: List[UploadJobStatus]

class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: int


class MeResponse(BaseModel):
    username: str
    expires_at: int


class PipelineTriggerRequest(BaseModel):
    use_scraping: bool = True
    use_pagination: bool = True
    year: Optional[int] = Field(None, ge=1900, description="Filtre année pour le scraping du pipeline")
    month: Optional[int] = Field(None, ge=1, le=12, description="Filtre mois pour le scraping du pipeline")
    day: Optional[int] = Field(None, ge=1, le=31, description="Filtre jour pour le scraping du pipeline")
    max_pages: Optional[int] = Field(None, ge=1)
    max_bulletins: Optional[int] = Field(None, ge=1)
    delay: float = Field(1.0, ge=0.0, description="Délai entre les téléchargements")


class PipelineRunSummary(BaseModel):
    id: int
    status: str
    started_at: str
    finished_at: Optional[str]
    metadata: Optional[dict]
    error_message: Optional[str] = None
    last_update: Optional[str] = None


class PipelineRunDetail(PipelineRunSummary):
    steps: List[Dict[str, Any]] = Field(default_factory=list)


class PipelineRunsPage(BaseModel):
    items: List[PipelineRunSummary]
    total: int
    limit: int
    offset: int


class DataIssue(BaseModel):
    id: int
    bulletin_date: Optional[str] = None
    map_type: Optional[str] = None
    code: Optional[str] = None
    message: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    resolved_at: Optional[str] = None
    resolution_note: Optional[str] = None
    details: Optional[dict] = None
    created_at: Optional[str] = None
    station_name: Optional[str] = None


class DataIssuesPage(BaseModel):
    items: List[DataIssue]
    total: int
    limit: int
    offset: int


class DataQualityResponse(BaseModel):
    average_quality: Optional[float] = None
    sample_size: int = 0
    date: Optional[str] = None


class IssueStatusUpdate(BaseModel):
    note: Optional[str] = None


class TemperatureCorrectionRequest(BaseModel):
    date: str
    station_name: str
    map_type: str = Field(..., pattern="^(observation|forecast)$")
    tmin: Optional[float] = None
    tmax: Optional[float] = None
    issue_id: Optional[int] = None


class MetricsRecalculateRequest(BaseModel):
    force: bool = False

class TranslationRegenerateRequest(BaseModel):
    date: str
    station_name: str
    language: Optional[str] = None  # moore, dioula ou None/all pour tout régénérer


class TextExtractionResult(BaseModel):
    """Résultat de l'extraction de texte d'un bulletin"""
    observation_text: Optional[str] = None
    forecast_text: Optional[str] = None
    extracted_at: str
    pdf_path: str


class TranslationResult(BaseModel):
    """Résultat d'une traduction"""
    language: str
    text: str
    translated_at: str
    source_text: str


class BulletinTranslationResponse(BaseModel):
    """Réponse complète pour les traductions d'un bulletin"""
    date: str
    french_text: Optional[str] = None
    moore_translation: Optional[str] = None
    dioula_translation: Optional[str] = None
    extracted_at: Optional[str] = None
    translations: List[TranslationResult] = Field(default_factory=list)


    class Config:
        json_schema_extra = {
            "example": {
                "items": [
                    {
                        "id": 12,
                        "status": "success",
                        "started_at": "2025-10-15T10:12:00",
                        "finished_at": "2025-10-15T10:16:30",
                        "metadata": {"bulletins_processed": 4},
                        "error_message": None,
                        "last_update": "2025-10-15T10:16:30",
                    }
                ],
                "total": 12,
                "limit": 20,
                "offset": 0,
            }
        }


class PipelineTriggerResponse(BaseModel):
    run_id: int
    status: str


class TempRetentionSettings(BaseModel):
    keep_days: int = Field(..., ge=1, description="Nombre de jours de conservation des fichiers temporaires.")
