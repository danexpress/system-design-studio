from fastapi import APIRouter, Depends, status

from ..auth import AuthService, get_auth
from ..models import LoginInput, TokenResponse

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/token", response_model=TokenResponse, status_code=status.HTTP_200_OK)
def create_token(
    data: LoginInput, auth: AuthService = Depends(get_auth)
) -> TokenResponse:
    principal = auth.authenticate(str(data.email), data.password)
    return TokenResponse(access_token=auth.issue_token(principal))
