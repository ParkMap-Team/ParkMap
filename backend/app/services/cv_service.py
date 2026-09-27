class ComputerVisionService:
    """Integration boundary for future YOLO motorcycle inference."""

    @property
    def is_configured(self) -> bool:
        return False


cv_service = ComputerVisionService()
