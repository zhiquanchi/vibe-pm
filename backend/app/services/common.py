def to_dict(obj):
    """Serialize an ORM instance to a plain dict covering every table column."""
    if obj is None:
        return None
    return {column.name: getattr(obj, column.name) for column in obj.__table__.columns}
