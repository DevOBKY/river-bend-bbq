import { useState } from 'react';
import { formatDollars, type MenuItem } from '../api.ts';
import { useApi } from '../useApi.ts';

const categories = ['all', 'meat', 'side', 'dessert', 'drink'];

export function MenuPage({ onAdd }: { onAdd: (item: MenuItem) => void }) {
  const [category, setCategory] = useState('all');
  const path = category === 'all' ? '/menu' : `/menu?category=${category}`;
  const { data, error, loading } = useApi<{ items: MenuItem[] }>(path);

  return (
    <section>
      <h1>Catering menu</h1>
      <div className="filters" role="group" aria-label="Filter by category">
        {categories.map((c) => (
          <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>
      {error && <p className="error">Couldn't load the menu: {error.message}</p>}
      {loading && !data && <p>Loading the menu…</p>}
      {data && (
        <ul className="menu">
          {data.items.map((item) => (
            <MenuItemCard key={item.id} item={item} onAdd={onAdd} />
          ))}
        </ul>
      )}
    </section>
  );
}

function MenuItemCard({ item, onAdd }: { item: MenuItem; onAdd: (item: MenuItem) => void }) {
  return (
    <li className="card">
      <span className="category">{item.category}</span>
      <h2>{item.name}</h2>
      <p className="price">{formatDollars(item.price_cents)}</p>
      <button onClick={() => onAdd(item)}>Add to order</button>
    </li>
  );
}
