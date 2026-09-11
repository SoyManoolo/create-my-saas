from src.core.exceptions import AppError


class AuthenticationError(AppError):
    status_code = 401
    code = "AUTHENTICATION_FAILED"
    message = "Could not authenticate the request."


class InvalidCredentialsError(AuthenticationError):
    code = "INVALID_CREDENTIALS"
    message = "The email or password is incorrect."


class MissingTokenError(AuthenticationError):
    code = "MISSING_TOKEN"
    message = "An access token is required."


class InvalidAccessTokenError(AuthenticationError):
    code = "INVALID_ACCESS_TOKEN"
    message = "The access token is invalid."


class ExpiredTokenError(AuthenticationError):
    code = "EXPIRED_TOKEN"
    message = "The access token has expired."


class InactiveUserError(AppError):
    status_code = 403
    code = "USER_INACTIVE"
    message = "The user account is inactive."
