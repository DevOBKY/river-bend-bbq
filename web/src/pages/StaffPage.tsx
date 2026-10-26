import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api.ts';
import { useApi } from '../useApi.ts';

type Staff = { id: number; name: string; email: string };
type OrderRow = { id: number; customer: string; pickup_at: string; status: string };

const nextStatus: Record<string, string> = { placed: 'ready', ready: 'picked_up' };

export function StaffPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);
  const me = useApi<{ staff: Staff }>('/auth/me', reloadKey);

  if (me.loading && !me.data) return <p>Loading…</p>;
  if (!me.data || (me.error instanceof ApiError && me.error.status === 401)) return <LoginForm onSignedIn={reload} />;

  async function signOut() {
    await api('/auth/logout', { method: 'POST' });
    reload();
  }

  return (
    <section>
      <div className="row">
        <h1>Orders</h1>
        <span>
          Signed in as {me.data.staff.name} <button onClick={signOut}>Sign out</button>
        </span>
      </div>
      <OrderList />
    </section>
  );
}

function OrderList() {
  const [status, setStatus] = useState('placed');
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error, loading } = useApi<{ orders: OrderRow[] }>(`/orders?status=${status}`, reloadKey);

  async function advance(order: OrderRow) {
    await api(`/orders/${order.id}`, { method: 'PATCH', body: { status: nextStatus[order.status] } });
    setReloadKey((k) => k + 1);
  }

  return (
    <>
      <div className="filters" role="group" aria-label="Order status">
        {['placed', 'ready', 'picked_up', 'cancelled'].map((s) => (
          <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s.replace('_', ' ')}
          </button>
        ))}
      </div>
      {error && <p className="error">{error.message}</p>}
      {loading && !data && <p>Loading orders…</p>}
      {data?.orders.length === 0 && <p>No orders here.</p>}
      <ul className="orders">
        {data?.orders.map((order) => (
          <li key={order.id} className="card">
            <strong>#{order.id}</strong> {order.customer}
            <span>{new Date(order.pickup_at).toLocaleString()}</span>
            {nextStatus[order.status] && (
              <button onClick={() => advance(order)}>Mark {nextStatus[order.status].replace('_', ' ')}</button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email, password } });
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section>
      <h1>Staff sign in</h1>
      <form onSubmit={signIn} className="checkout">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
