"""Engine error types. Every error carries a message that is safe to show to a mission planner."""


class EngineError(Exception):
    """Base class for all MARGA engine errors."""


class InvalidInputError(EngineError):
    """A request field is missing, non-finite or outside its allowed range."""


class CoverageError(EngineError):
    """A requested point lies outside the loaded terrain package."""


class TerrainDataError(EngineError):
    """A terrain package or raster is malformed, inconsistent or unreadable."""
