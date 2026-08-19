class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
    ):
        self.status_code = status_code
        self.code = code
        self.message = message


class InvalidCredentialsError(AppError):
    status_code = 401
    code = "INVALID_CREDENTIALS"
    message = "Could not validate credentials"


class UserNotFoundError(AppError):
    status_code = 404
    code = "USER_NOT_FOUND"
    message = "User not found"


class EmailAlreadyExistsError(AppError):
    status_code = 409
    code = "EMAIL_ALREADY_EXISTS"
    message = "Email is already registered"


class InactiveUserError(AppError):
    status_code = 403
    code = "USER_INACTIVE"
    message = "User is inactive"