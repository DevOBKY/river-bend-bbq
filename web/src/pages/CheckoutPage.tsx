import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, ApiError, formatDollars, type CartLine, type Order } from '../api.ts';

type Props = { cart: CartLine[]; onRemove: (itemId: number) => void; onOrdered: () => void };

export function CheckoutPage({ cart, onRemove, onOrdered }: Props) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', pickup: '' });
  const [error, setError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [placed, setPlaced] = useState<Order | null>(null);

  const totalCents = cart.reduce((sum, line) => sum + line.item.price_cents * line.quantity, 0);

  function update(field: keyof typeof form, value: string) {
    setForm({ ...form, [field]: value });
  }

  async function placeOrder(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await api<{ order: Order }>('/orders', {
        method: 'POST',
        body: {
          customer: { name: form.name, email: form.email, phone: form.phone || undefined },
          // The input gives local time, like "2026-11-07T12:00"; the API wants a full timestamp.
          pickupAt: form.pickup ? new Date(form.pickup).toISOString() : '',
          items: cart.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
        },
      });
      setPlaced(result.order);
      onOrdered();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'Could not reach the server. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (placed) {
    return (
      <section>
        <h1>Thanks, {placed.customer}!</h1>
        <p>
          Order #{placed.id} is booked for pickup on {new Date(placed.pickup_at).toLocaleString()}. Total{' '}
          {formatDollars(placed.total_cents)}.
        </p>
        <Link to="/">Back to the menu</Link>
      </section>
    );
  }

  if (cart.length === 0) {
    return (
      <section>
        <h1>Your order</h1>
        <p>
          Nothing here yet. <Link to="/">Browse the menu</Link>.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h1>Your order</h1>
      <ul className="cart">
        {cart.map((line) => (
          <li key={line.item.id}>
            <span>
              {line.quantity} × {line.item.name}
            </span>
            <span>{formatDollars(line.item.price_cents * line.quantity)}</span>
            <button onClick={() => onRemove(line.item.id)} aria-label={`Remove ${line.item.name}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="total">Total {formatDollars(totalCents)}</p>

      <form onSubmit={placeOrder} className="checkout">
        <label>
          Name
          <input value={form.name} onChange={(e) => update('name', e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} required />
        </label>
        <label>
          Phone (optional)
          <input type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} />
        </label>
        <label>
          Pickup time
          <input type="datetime-local" value={form.pickup} onChange={(e) => update('pickup', e.target.value)} required />
        </label>
        {error && (
          <div className="error" role="alert">
            <p>{error.message}</p>
            {error.issues.length > 0 && (
              <ul>
                {error.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Placing order…' : `Place order (${formatDollars(totalCents)})`}
        </button>
      </form>
    </section>
  );
}
