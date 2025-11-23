import { Providers } from "./providers";
import "./globals.css";
import '@ant-design/v5-patch-for-react-19';

export const metadata = {
  title: "PlanterBox",
  description: "Automated Plant Care System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
