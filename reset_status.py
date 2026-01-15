import database as db

with db.get_db() as conn:
    cursor = conn.cursor()
    cursor.execute("UPDATE targets SET status = 'pending'")
    count = cursor.rowcount
    print(f"Reset {count} companies to 'pending' status")



