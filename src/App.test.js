import { render, screen } from '@testing-library/react';
import App from './App';

test('renders speech demo title', () => {
  render(<App />);
  const headingElement = screen.getByText(/speech-to-text-to-speech playground/i);
  expect(headingElement).toBeInTheDocument();
});
