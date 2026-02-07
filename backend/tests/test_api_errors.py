from backend.api_errors import ErrorCode, error_payload, status_to_code


def test_error_payload_shape():
    payload = error_payload(
        status=404,
        code=ErrorCode.RESOURCE_NOT_FOUND.value,
        message="Not found.",
        trace_id="trace-123",
        details={"resource": "bulletin"},
    )
    assert payload["success"] is False
    assert payload["error"]["code"] == ErrorCode.RESOURCE_NOT_FOUND.value
    assert payload["error"]["message"] == "Not found."
    assert payload["error"]["status"] == 404
    assert payload["error"]["traceId"] == "trace-123"
    assert payload["error"]["details"] == {"resource": "bulletin"}


def test_status_to_code_known_mapping():
    assert status_to_code(404) == ErrorCode.RESOURCE_NOT_FOUND.value
