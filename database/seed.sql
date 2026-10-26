INSERT INTO customers (name, email, phone) VALUES
  ('Dana Whitfield', 'dana@example.com', '270-555-0141'),
  ('Marcus Hale', 'marcus@example.com', NULL),
  ('Owensboro Rotary Club', 'events@example.org', '270-555-0199'),
  ('Priya Raman', 'priya@example.com', '270-555-0117'),
  ('Tom Bishop', 'tom@example.com', NULL);

INSERT INTO menu_items (name, category, price_cents) VALUES
  ('Pulled pork (lb)', 'meat', 1499),
  ('Mutton (lb)', 'meat', 1699),
  ('Brisket (lb)', 'meat', 1899),
  ('Burgoo (quart)', 'side', 999),
  ('Baked beans (quart)', 'side', 799),
  ('Coleslaw (quart)', 'side', 699),
  ('Banana pudding (pan)', 'dessert', 2499),
  ('Sweet tea (gallon)', 'drink', 599),
  ('Cornbread (dozen)', 'side', 899);

INSERT INTO orders (customer_id, pickup_at, status) VALUES
  (1, '2026-10-02 11:30-05', 'picked_up'),
  (3, '2026-10-09 17:00-05', 'picked_up'),
  (2, '2026-10-10 12:00-05', 'cancelled'),
  (1, '2026-10-16 11:30-05', 'picked_up'),
  (4, '2026-10-18 16:00-05', 'ready'),
  (3, '2026-10-24 17:00-05', 'placed');

INSERT INTO order_items (order_id, menu_item_id, quantity, unit_price_cents) VALUES
  (1, 1, 2, 1499), (1, 6, 1, 699),
  (2, 1, 10, 1399), (2, 2, 6, 1599), (2, 4, 4, 999), (2, 5, 4, 799), (2, 8, 5, 599),
  (3, 3, 1, 1899),
  (4, 1, 2, 1499), (4, 4, 1, 999),
  (5, 3, 3, 1899), (5, 7, 1, 2499),
  (6, 1, 12, 1499), (6, 2, 8, 1699), (6, 4, 6, 999), (6, 7, 2, 2499);
