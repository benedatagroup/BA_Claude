sap.ui.define([
    "./BaseController",
    "../model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast"
], (BaseController, formatter, JSONModel, Filter, FilterOperator, Sorter, MessageToast) => {
    "use strict";

    return BaseController.extend("baclaude.controller.Worklist", {

        formatter: formatter,

        /* =========================================================== */
        /* lifecycle methods                                           */
        /* =========================================================== */

        onInit() {
            const oViewModel = new JSONModel({
                tableBusyDelay: 0,
                tableTitle: this.getResourceBundle().getText("worklistTableTitle"),
                itemCount: 0,
                sortDescending: true
            });
            this.setModel(oViewModel, "view");

            // delay table busy indicator only after the first data has been loaded
            this.getView().attachEventOnce("afterRendering", () => {
                oViewModel.setProperty("/tableBusyDelay", 1000);
            });
        },

        /* =========================================================== */
        /* event handlers                                              */
        /* =========================================================== */

        /** Updates the toolbar title with the current row count after the table has loaded. */
        onUpdateFinished(oEvent) {
            const iTotal = oEvent.getParameter("total");
            const oViewModel = this.getModel("view");
            const oResourceBundle = this.getResourceBundle();
            const sTitle = iTotal && iTotal > 0
                ? oResourceBundle.getText("worklistTableTitleCount", [iTotal])
                : oResourceBundle.getText("worklistTableTitle");
            oViewModel.setProperty("/tableTitle", sTitle);
            oViewModel.setProperty("/itemCount", iTotal || 0);
        },

        /** Triggered by the SearchField – re-applies the combined filter set. */
        onSearch() {
            this._applyFilters();
        },

        /** Generic handler for any change in a filter input or the segmented button. */
        onFilterChange() {
            this._applyFilters();
        },

        /** Resets all filters to their initial state. */
        onClearFilters() {
            this.byId("statusFilter").setSelectedKey("all");
            this.byId("vendorFilter").setValue("");
            this.byId("dateFilter").setValue("");
            this.byId("currencyFilter").setSelectedKey("");
            this.byId("amountFrom").setValue("");
            this.byId("amountTo").setValue("");
            this.byId("searchField").setValue("");
            this._applyFilters();
            MessageToast.show(this.getResourceBundle().getText("messageFiltersCleared"));
        },

        /** Refreshes the OData binding so the latest data is fetched. */
        onRefresh() {
            const oBinding = this.byId("invoicesTable").getBinding("items");
            oBinding.refresh(true);
            MessageToast.show(this.getResourceBundle().getText("messageRefreshed"));
        },

        /** Toggles the sort order of the InvoiceDate column. */
        onSort() {
            const oViewModel = this.getModel("view");
            const bDescending = !oViewModel.getProperty("/sortDescending");
            oViewModel.setProperty("/sortDescending", bDescending);
            const oBinding = this.byId("invoicesTable").getBinding("items");
            oBinding.sort(new Sorter("InvoiceDate", bDescending));
            MessageToast.show(this.getResourceBundle().getText(
                bDescending ? "messageSortDesc" : "messageSortAsc"
            ));
        },

        /** Navigates to the object page when a row is pressed. */
        onItemPress(oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const sInvoiceId = oContext.getProperty("InvoiceId");
            this.getRouter().navTo("object", {
                invoiceId: encodeURIComponent(sInvoiceId)
            });
        },

        /* =========================================================== */
        /* internal methods                                            */
        /* =========================================================== */

        /**
         * Builds a combined OData filter from all filter inputs and applies it
         * to the table's "items" aggregation binding.
         */
        _applyFilters() {
            const aFilters = [];

            // Status filter (segmented button)
            const sStatus = this.byId("statusFilter").getSelectedKey();
            if (sStatus && sStatus !== "all") {
                aFilters.push(new Filter("Status", FilterOperator.EQ, sStatus));
            }

            // Vendor name (contains)
            const sVendor = this.byId("vendorFilter").getValue().trim();
            if (sVendor) {
                aFilters.push(new Filter("VendorName", FilterOperator.Contains, sVendor));
            }

            // Invoice date range
            const oDateRange = this.byId("dateFilter");
            const oDateFrom = oDateRange.getDateValue();
            const oDateTo = oDateRange.getSecondDateValue();
            if (oDateFrom && oDateTo) {
                aFilters.push(new Filter("InvoiceDate", FilterOperator.BT, oDateFrom, oDateTo));
            } else if (oDateFrom) {
                aFilters.push(new Filter("InvoiceDate", FilterOperator.GE, oDateFrom));
            }

            // Currency
            const sCurrency = this.byId("currencyFilter").getSelectedKey();
            if (sCurrency) {
                aFilters.push(new Filter("Currency", FilterOperator.EQ, sCurrency));
            }

            // Gross amount range
            const sAmountFrom = this.byId("amountFrom").getValue();
            const sAmountTo = this.byId("amountTo").getValue();
            const fAmountFrom = parseFloat(sAmountFrom);
            const fAmountTo = parseFloat(sAmountTo);
            const bHasFrom = !isNaN(fAmountFrom);
            const bHasTo = !isNaN(fAmountTo);
            if (bHasFrom && bHasTo) {
                aFilters.push(new Filter("GrossAmount", FilterOperator.BT, fAmountFrom, fAmountTo));
            } else if (bHasFrom) {
                aFilters.push(new Filter("GrossAmount", FilterOperator.GE, fAmountFrom));
            } else if (bHasTo) {
                aFilters.push(new Filter("GrossAmount", FilterOperator.LE, fAmountTo));
            }

            // Free text search across InvoiceNumber, VendorName, ReferenceNumber
            const sSearch = this.byId("searchField").getValue().trim();
            if (sSearch) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("InvoiceNumber", FilterOperator.Contains, sSearch),
                        new Filter("VendorName", FilterOperator.Contains, sSearch),
                        new Filter("ReferenceNumber", FilterOperator.Contains, sSearch)
                    ],
                    and: false
                }));
            }

            const oTable = this.byId("invoicesTable");
            const oBinding = oTable.getBinding("items");
            const oCombined = aFilters.length
                ? new Filter({ filters: aFilters, and: true })
                : [];
            oBinding.filter(oCombined);
        }
    });
});
