#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Pipeline recovery system for automatic resumption after system crashes or interruptions.
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime, timedelta

from backend.modules.pipeline_runner import PipelineRunner
from backend.utils.config import Config
from backend.utils.database import DatabaseManager

logger = logging.getLogger("anam.pipeline.recovery")

class PipelineRecoveryManager:
    """Manages automatic pipeline recovery after system interruptions."""
    
    def __init__(self, config: Config, db_manager: DatabaseManager):
        self.config = config
        self.db_manager = db_manager
    
    def find_interrupted_runs(self) -> list:
        """Find pipeline runs that were interrupted (running status but no recent updates)."""
        conn = self.db_manager.get_connection()
        cursor = conn.cursor()
        
        # Find runs that are marked as running but haven't been updated recently
        # (indicating they were interrupted)
        cutoff_time = datetime.utcnow() - timedelta(minutes=5)
        cursor.execute(
            '''
            SELECT id, started_at, finished_at, status, steps_json, error_message, metadata, last_update
            FROM pipeline_runs
            WHERE status = 'running' 
            AND (last_update IS NULL OR last_update < ?)
            ORDER BY started_at DESC
            ''',
            (cutoff_time.isoformat(),)
        )
        
        rows = cursor.fetchall()
        interrupted_runs = []
        
        for row in rows:
            run_data = self.db_manager._deserialize_pipeline_row(row)
            # Additional validation: check if it's really interrupted
            if self._is_actually_interrupted(run_data):
                interrupted_runs.append(run_data)
        
        return interrupted_runs
    
    def _is_actually_interrupted(self, run_data: Dict[str, Any]) -> bool:
        """Determine if a run is actually interrupted vs just slow."""
        last_update = run_data.get("last_update")
        if not last_update:
            return True  # No update timestamp means definitely interrupted
            
        try:
            update_time = datetime.fromisoformat(last_update.replace('Z', '+00:00'))
            time_since_update = datetime.utcnow() - update_time
            
            # Consider interrupted if no update for more than 10 minutes
            return time_since_update > timedelta(minutes=10)
        except (ValueError, TypeError):
            return True  # Invalid timestamp format
    
    def recover_run(self, run_id: int) -> bool:
        """Recover a specific interrupted pipeline run."""
        try:
            run_data = self.db_manager.get_pipeline_run(run_id)
            if not run_data:
                logger.warning(f"Run {run_id} not found")
                return False
            
            if run_data.get("status") != "running":
                logger.info(f"Run {run_id} is not in running state, skipping recovery")
                return False
            
            if not self._is_actually_interrupted(run_data):
                logger.info(f"Run {run_id} appears to be still active, skipping recovery")
                return False
            
            logger.info(f"Recovering pipeline run {run_id}")
            
            # Create runner from existing run data
            runner = PipelineRunner.create_from_existing_run(
                self.config, 
                self.db_manager, 
                run_id, 
                run_data
            )
            
            # Mark the run as recovering
            self.db_manager.update_pipeline_run(
                run_id, 
                status="recovering",
                metadata={**run_data.get("metadata", {}), "recovery_started": datetime.utcnow().isoformat()}
            )
            
            # Start the recovery process in background
            import asyncio
            from fastapi.concurrency import run_in_threadpool
            
            async def start_recovery():
                await run_in_threadpool(runner.resume_from_interrupt)
            
            asyncio.create_task(start_recovery())
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to recover run {run_id}: {e}")
            # Mark as failed if recovery fails
            self.db_manager.update_pipeline_run(run_id, status="error", error_message=f"Recovery failed: {e}")
            return False
    
    def recover_all_interrupted_runs(self) -> int:
        """Recover all interrupted pipeline runs and return count of successful recoveries."""
        interrupted_runs = self.find_interrupted_runs()
        recovered_count = 0
        
        if not interrupted_runs:
            logger.info("No interrupted runs found")
            return 0
        
        logger.info(f"Found {len(interrupted_runs)} interrupted runs to recover")
        
        for run_data in interrupted_runs:
            run_id = run_data["id"]
            if self.recover_run(run_id):
                recovered_count += 1
        
        logger.info(f"Successfully initiated recovery for {recovered_count} runs")
        return recovered_count
    
    def cleanup_stale_runs(self) -> int:
        """Clean up runs that are stuck in 'recovering' state for too long."""
        conn = self.db_manager.get_connection()
        cursor = conn.cursor()
        
        cutoff_time = datetime.utcnow() - timedelta(hours=1)
        cursor.execute(
            '''
            SELECT id
            FROM pipeline_runs
            WHERE status = 'recovering' 
            AND last_update < ?
            ''',
            (cutoff_time.isoformat(),)
        )
        
        stale_runs = cursor.fetchall()
        cleaned_count = 0
        
        for (run_id,) in stale_runs:
            try:
                self.db_manager.update_pipeline_run(
                    run_id, 
                    status="error", 
                    error_message="Recovery process timed out",
                    finished=True
                )
                cleaned_count += 1
                logger.warning(f"Cleaned up stale recovery run {run_id}")
            except Exception as e:
                logger.error(f"Failed to clean up run {run_id}: {e}")
        
        if cleaned_count > 0:
            logger.info(f"Cleaned up {cleaned_count} stale recovery runs")
        
        return cleaned_count