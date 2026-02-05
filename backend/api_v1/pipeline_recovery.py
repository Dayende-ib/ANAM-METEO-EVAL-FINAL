#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Automatic pipeline recovery integration for API startup.
"""

import logging
from fastapi import APIRouter
from backend.api_v1.core import _ensure_db_ready
from backend.modules.pipeline_recovery import PipelineRecoveryManager
import backend.api_v1.core as core

logger = logging.getLogger("anam.api")

router = APIRouter(tags=["pipeline-recovery"])

@router.post("/pipeline/recover")
async def recover_interrupted_pipelines():
    """Recover all interrupted pipeline runs."""
    _ensure_db_ready()
    assert core.db_manager is not None and core.config is not None
    
    recovery_manager = PipelineRecoveryManager(core.config, core.db_manager)
    recovered_count = recovery_manager.recover_all_interrupted_runs()
    cleaned_count = recovery_manager.cleanup_stale_runs()
    
    return {
        "message": f"Recovered {recovered_count} interrupted runs, cleaned {cleaned_count} stale runs",
        "recovered_count": recovered_count,
        "cleaned_count": cleaned_count
    }

def auto_recover_on_startup():
    """Automatically recover interrupted pipelines on server startup."""
    try:
        if core.db_manager is not None and core.config is not None:
            recovery_manager = PipelineRecoveryManager(core.config, core.db_manager)
            recovered_count = recovery_manager.recover_all_interrupted_runs()
            cleaned_count = recovery_manager.cleanup_stale_runs()
            
            if recovered_count > 0:
                logger.info(f"Auto-recovered {recovered_count} interrupted pipeline runs")
            if cleaned_count > 0:
                logger.info(f"Cleaned up {cleaned_count} stale recovery runs")
                
            return recovered_count
        else:
            logger.warning("Database or config not ready for auto-recovery")
            return 0
    except Exception as e:
        logger.error(f"Auto-recovery failed: {e}")
        return 0