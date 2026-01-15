"""
CLI utility functions.
"""


def calculate_grid_positions(num_windows: int, screen_width: int = 1920, screen_height: int = 1080):
    """
    Calculate window positions for a grid layout.
    Returns list of (x, y, width, height) tuples.
    """
    if num_windows <= 0:
        return []
    
    # For 3 windows, arrange horizontally
    if num_windows <= 3:
        cols = num_windows
        rows = 1
    elif num_windows <= 6:
        cols = 3
        rows = 2
    else:
        cols = 4
        rows = (num_windows + 3) // 4
    
    window_width = screen_width // cols
    window_height = screen_height // rows
    
    positions = []
    for i in range(num_windows):
        row = i // cols
        col = i % cols
        x = col * window_width
        y = row * window_height
        positions.append((x, y, window_width, window_height))
    
    return positions


