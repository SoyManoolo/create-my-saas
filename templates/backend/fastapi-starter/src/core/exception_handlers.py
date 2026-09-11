from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from src.core.exceptions import AppError

async def app_error_handler(
    request: Request,
    exc: AppError,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
            }
        },
    )


async def request_validation_error_handler(_: Request, __: RequestValidationError) -> JSONResponse:
    """Do not reflect invalid request values (which can include credentials) to clients."""
    return JSONResponse(
        status_code=422,
        content={"error": {"code": "HTTP_422", "message": "The request payload is invalid."}},
    )
