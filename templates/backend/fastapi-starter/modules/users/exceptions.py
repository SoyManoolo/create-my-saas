from core.exceptions import AppError


class UserNotFoundError(AppError):
    status_code = 404
    code = "USER_NOT_FOUND"
    message = "User not found."


class EmailAlreadyExistsError(AppError):
    status_code = 409
    code = "EMAIL_ALREADY_EXISTS"
    message = "An account with this email already exists."


class EmailNotVerifiedError(AppError):
    status_code = 403
    code = "EMAIL_NOT_VERIFIED"
    message = "The email address has not been verified."
