from scripts.check_service_boundaries import main as check_service_boundaries_main


def test_service_boundaries():
    assert check_service_boundaries_main() == 0

