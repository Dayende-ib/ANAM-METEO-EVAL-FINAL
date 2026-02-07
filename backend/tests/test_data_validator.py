from backend.modules.data_validator import DataValidator


def test_validate_measurement_swaps_tmin_tmax():
    validator = DataValidator()
    measurement = {
        "tmin": 30.0,
        "tmax": 20.0,
        "weather_condition": "sunny",
        "tmin_raw": "30",
        "tmax_raw": "20",
    }

    cleaned, warnings, issues = validator.validate_measurement(
        "Ouagadougou",
        measurement,
        "forecast",
    )

    assert cleaned["tmax"] == 30.0
    assert warnings
    assert issues


def test_validate_measurement_reports_invalid_tmin():
    validator = DataValidator()
    measurement = {
        "tmin": "abc",
        "tmax": 32.0,
    }

    cleaned, warnings, issues = validator.validate_measurement(
        "Ouagadougou",
        measurement,
        "forecast",
    )

    assert cleaned["tmin"] is None
    assert any("tmin" in warning for warning in warnings)
    assert any(issue.get("code") == "INVALID_TMIN" for issue in issues)
