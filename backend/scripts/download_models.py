import argparse
import os
from pathlib import Path

# On importe snapshot_download pour télécharger des dossiers entiers
from huggingface_hub import hf_hub_download, snapshot_download

DEFAULT_MODELS = {
    "nllb": {
        "repo": "facebook/nllb-200-distilled-600M",
        "type": "folder",
        "description": "Version légère NLLB-200 600M (Config + Poids + Tokenizer)",
    },
}

def download_model(alias: str, base_dir: Path):
    config = DEFAULT_MODELS[alias]
    target_dir = base_dir / alias
    target_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"⬇️  Début du téléchargement pour : {alias} ({config['repo']})...")

    try:
        if config["type"] == "single_file":
            # Cas pour les GGUF (si on voulait revenir en arrière)
            path = hf_hub_download(
                repo_id=config["repo"],
                filename=config["filename"],
                local_dir=target_dir,
                local_dir_use_symlinks=False, 
            )
        elif config["type"] == "folder":
            # Pour Transformers : on télécharge tout le dépôt (sauf les fichiers inutiles)
            path = snapshot_download(
                repo_id=config["repo"],
                local_dir=target_dir,
                local_dir_use_symlinks=False,
                # On exclut les formats TensorFlow (.h5) ou Flax (.msgpack) pour ne garder que PyTorch (.safetensors/.bin)
                ignore_patterns=["*.h5", "*.msgpack", "*.ot", "flax_model.msgpack"] 
            )

        print(f"✅ {alias} téléchargé avec succès dans : {path}\n")
        
    except Exception as e:
        print(f"\n❌ ERREUR lors du téléchargement de {alias} : {e}")
        raise e


def main(argv=None):
    parser = argparse.ArgumentParser(description="Télécharger les modèles IA en local.")
    parser.add_argument(
        "--models",
        nargs="+",
        choices=list(DEFAULT_MODELS.keys()) + ["all"],
        default=["all"],
        help="Choisir quels modèles télécharger",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models",
        help="Dossier cible",
    )
    args = parser.parse_args(argv)

    selections = list(DEFAULT_MODELS.keys()) if "all" in args.models else args.models
    
    for alias in selections:
        try:
            download_model(alias, args.output)
        except Exception:
            pass # L'erreur est déjà affichée dans download_model

if __name__ == "__main__":
    main()