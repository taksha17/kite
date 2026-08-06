import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BankImportPage } from "./pages/BankImportPage";
import { AskPage } from "./pages/AskPage";
import { FollowUpPage } from "./pages/FollowUpPage";
import { CompaniesPage } from "./pages/CompaniesPage";
import { HomePage } from "./pages/HomePage";
import { InvoicePage } from "./pages/InvoicePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { LedgersPage } from "./pages/LedgersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { UsersPage } from "./pages/UsersPage";
import { VoucherEditorPage } from "./pages/VoucherEditorPage";
import { VouchersPage } from "./pages/VouchersPage";
import { AppProvider } from "./state/AppContext";
import "./styles/global.css";

export default function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="companies" element={<CompaniesPage />} />
            <Route path="integrations" element={<IntegrationsPage />} />
            <Route path="ledgers" element={<LedgersPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="vouchers" element={<VouchersPage />} />
            <Route path="bank-import" element={<BankImportPage />} />
            <Route path="ask" element={<AskPage />} />
            <Route path="follow-up" element={<FollowUpPage />} />
          <Route path="vouchers/new" element={<VoucherEditorPage />} />
          <Route path="vouchers/:id/edit" element={<VoucherEditorPage />} />
          <Route path="vouchers/:id/invoice" element={<InvoicePage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
