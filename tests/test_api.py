from fastapi.testclient import TestClient
from app.main import app
client=TestClient(app)
def test_health(): assert client.get('/api/health').json()['status']=='ok'
def test_seed_sprint(): assert client.get('/api/sprints').status_code == 200
