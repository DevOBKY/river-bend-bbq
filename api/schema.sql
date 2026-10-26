DROP TABLE IF EXISTS jobs, idempotency_keys, sessions, staff, order_items, orders, menu_items, customers;

CREATE TABLE customers (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  phone      text
);

CREATE TABLE menu_items (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  category    text NOT NULL CHECK (category IN ('meat', 'side', 'dessert', 'drink')),
  price_cents integer NOT NULL CHECK (price_cents > 0)
);

CREATE TABLE orders (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customers (id),
  pickup_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'placed'
              CHECK (status IN ('placed', 'ready', 'picked_up', 'cancelled'))
);

CREATE TABLE order_items (
  order_id         integer NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id     integer NOT NULL REFERENCES menu_items (id),
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_cents integer NOT NULL,
  PRIMARY KEY (order_id, menu_item_id)
);

CREATE TABLE staff (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  staff_id   integer NOT NULL REFERENCES staff (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

-- Work to do in the background, like sending emails (S3, lesson 2).
CREATE TABLE jobs (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text NOT NULL,
  payload    jsonb NOT NULL,
  run_after  timestamptz NOT NULL DEFAULT now(),
  attempts   integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_due ON jobs (run_after);

-- Remembers each checkout attempt, so a retried request can't place the order twice (S3, lesson 5).
CREATE TABLE idempotency_keys (
  key          text PRIMARY KEY,
  request_hash text NOT NULL,
  order_id     integer REFERENCES orders (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
