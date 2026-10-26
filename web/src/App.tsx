import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import type { CartLine, MenuItem } from './api.ts';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { MenuPage } from './pages/MenuPage.tsx';
import { StaffPage } from './pages/StaffPage.tsx';

export default function App() {
  // The cart lives here, above every page that needs it.
  const [cart, setCart] = useState<CartLine[]>([]);

  function addToCart(item: MenuItem) {
    setCart((lines) => {
      const existing = lines.find((line) => line.item.id === item.id);
      if (existing) {
        return lines.map((line) => (line === existing ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [...lines, { item, quantity: 1 }];
    });
  }

  function removeFromCart(itemId: number) {
    setCart((lines) => lines.filter((line) => line.item.id !== itemId));
  }

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <>
      <header className="site-header">
        <strong>River Bend BBQ</strong>
        <nav>
          <NavLink to="/" end>
            Menu
          </NavLink>
          <NavLink to="/checkout">Cart ({itemCount})</NavLink>
          <NavLink to="/staff">Staff</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<MenuPage onAdd={addToCart} />} />
          <Route
            path="/checkout"
            element={<CheckoutPage cart={cart} onRemove={removeFromCart} onOrdered={() => setCart([])} />}
          />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
