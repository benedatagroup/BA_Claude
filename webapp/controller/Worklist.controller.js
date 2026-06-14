sap.ui.define([
    "./BaseController",
    "../model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/core/ValueState",
    "sap/ui/core/format/DateFormat",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (BaseController, formatter, JSONModel, Filter, FilterOperator, Sorter, ValueState, DateFormat, MessageToast, MessageBox) => {
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

            // Separate model that feeds the "invoices per month" chart. It is filled
            // independently of the table binding so the chart always reflects the full
            // data set, regardless of the active list filters.
            this.setModel(new JSONModel({ months: [] }), "chart");

            // delay table busy indicator only after the first data has been loaded
            this.getView().attachEventOnce("afterRendering", () => {
                oViewModel.setProperty("/tableBusyDelay", 1000);
            });

            this._loadChartData();
            this._initChart();
        },

        /** Applies the static visual configuration of the invoice chart. */
        _initChart() {
            const oBundle = this.getResourceBundle();
            this.byId("invoiceChart").setVizProperties({
                title: {
                    visible: true,
                    text: oBundle.getText("chartPanelTitle")
                },
                plotArea: {
                    dataLabel: { visible: true }
                },
                valueAxis: {
                    title: { visible: true, text: oBundle.getText("chartMeasureCount") }
                },
                categoryAxis: {
                    title: { visible: true, text: oBundle.getText("chartDimensionMonth") }
                },
                legend: { visible: false }
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
        /* create invoice                                              */
        /* =========================================================== */

        /**
         * Opens the "create invoice" dialog. The fragment is loaded lazily on first use and
         * kept for subsequent opens; its input fields are reset to their initial state each
         * time so a previously cancelled entry does not leak into the next one.
         */
        onCreatePress() {
            const fnOpen = (oDialog) => {
                this._resetCreateDialog();
                oDialog.open();
            };

            if (this._pCreateDialog) {
                this._pCreateDialog.then(fnOpen);
                return;
            }

            // loadFragment prefixes the fragment's control ids with the view id (so this.byId
            // resolves them) and registers the dialog as a dependent of the view automatically.
            this._pCreateDialog = this.loadFragment({
                name: "baclaude.view.fragment.CreateInvoice"
            });
            this._pCreateDialog.then(fnOpen);
        },

        /**
         * Validates the dialog input and, when valid, creates a new invoice in status "Draft"
         * via an OData create request. Net/tax/gross start at 0 and are later derived from the
         * line items that are added separately on the object page. On success the table binding
         * is refreshed so the new invoice shows up in the list right away.
         */
        onCreateConfirm() {
            const oData = this._readCreateInput();
            if (!this._validateCreate(oData)) {
                return;
            }

            const oModel = this.getModel();

            // Drop any transient entry left over from a previous failed attempt so a retry does
            // not submit a duplicate invoice. The worklist itself makes no other pending changes.
            if (oModel.hasPendingChanges()) {
                oModel.resetChanges();
            }

            const oProperties = {
                InvoiceId: "INV-" + Date.now(),
                InvoiceNumber: oData.invoiceNumber,
                VendorName: oData.vendorName,
                InvoiceDate: oData.invoiceDate,
                NetAmount: "0.00",
                TaxAmount: "0.00",
                GrossAmount: "0.00",
                Currency: oData.currency,
                Status: "Draft"
            };
            if (oData.dueDate) {
                oProperties.DueDate = oData.dueDate;
            }

            oModel.createEntry("/Invoices", { properties: oProperties });

            const oView = this.getView();
            const oBundle = this.getResourceBundle();
            const that = this;
            oView.setBusy(true);

            // The service runs in non-batch mode (manifest: useBatch=false). In that mode the
            // success/error callbacks of submitChanges are not invoked, so the model-level
            // request events are used to react to the create result (mirrors the Object controller).
            const oReq = {};
            const fnCleanup = () => {
                oModel.detachRequestCompleted(oReq.completed);
                oModel.detachRequestFailed(oReq.failed);
                oView.setBusy(false);
            };
            oReq.completed = (oEvent) => {
                fnCleanup();
                if (oEvent.getParameter("success")) {
                    that._closeCreateDialog();
                    that.byId("invoicesTable").getBinding("items").refresh();
                    that._loadChartData();
                    MessageToast.show(oBundle.getText("messageCreateSuccess"));
                } else {
                    MessageBox.error(oBundle.getText("messageCreateError"));
                }
            };
            oReq.failed = () => {
                fnCleanup();
                MessageBox.error(oBundle.getText("messageCreateError"));
            };

            oModel.attachRequestCompleted(oReq.completed);
            oModel.attachRequestFailed(oReq.failed);
            oModel.submitChanges();
        },

        /** Discards the pending entry and closes the dialog. */
        onCreateCancel() {
            const oModel = this.getModel();
            if (oModel.hasPendingChanges()) {
                oModel.resetChanges();
            }
            this._closeCreateDialog();
        },

        /** Clears inline validation feedback once the dialog has fully closed. */
        onCreateDialogAfterClose() {
            this._resetCreateDialog();
        },

        /** Reads the current dialog input into a plain object. */
        _readCreateInput() {
            return {
                invoiceNumber: this.byId("createInvoiceNumberInput").getValue().trim(),
                vendorName: this.byId("createVendorInput").getValue().trim(),
                invoiceDate: this.byId("createInvoiceDatePicker").getDateValue(),
                currency: this.byId("createCurrencySelect").getSelectedKey(),
                dueDate: this.byId("createDueDatePicker").getDateValue()
            };
        },

        /**
         * Validates the mandatory create fields (invoice number, vendor, invoice date, currency).
         * Shows inline value states on the offending controls and an aggregated error dialog.
         * Returns true when all mandatory values are present.
         */
        _validateCreate(oData) {
            const oBundle = this.getResourceBundle();
            const aMessages = [];

            const oInvoiceNumber = this.byId("createInvoiceNumberInput");
            const oVendor = this.byId("createVendorInput");
            const oInvoiceDate = this.byId("createInvoiceDatePicker");
            const oCurrency = this.byId("createCurrencySelect");

            [oInvoiceNumber, oVendor, oInvoiceDate, oCurrency].forEach((oControl) => oControl.setValueState(ValueState.None));

            if (!oData.invoiceNumber) {
                const sMsg = oBundle.getText("validationInvoiceNumberRequired");
                oInvoiceNumber.setValueState(ValueState.Error);
                oInvoiceNumber.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            if (!oData.vendorName) {
                const sMsg = oBundle.getText("validationVendorRequired");
                oVendor.setValueState(ValueState.Error);
                oVendor.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            if (!oData.invoiceDate) {
                const sMsg = oBundle.getText("validationInvoiceDateRequired");
                oInvoiceDate.setValueState(ValueState.Error);
                oInvoiceDate.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            if (!oData.currency) {
                const sMsg = oBundle.getText("validationCurrencyRequired");
                oCurrency.setValueState(ValueState.Error);
                oCurrency.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            if (aMessages.length) {
                MessageBox.error(aMessages.join("\n"), {
                    title: oBundle.getText("validationErrorTitle")
                });
                return false;
            }
            return true;
        },

        /** Resets all dialog fields and their value states to the initial empty state. */
        _resetCreateDialog() {
            this.byId("createInvoiceNumberInput").setValue("").setValueState(ValueState.None);
            this.byId("createVendorInput").setValue("").setValueState(ValueState.None);
            this.byId("createInvoiceDatePicker").setValue("").setValueState(ValueState.None);
            this.byId("createCurrencySelect").setSelectedKey("").setValueState(ValueState.None);
            this.byId("createDueDatePicker").setValue("");
        },

        /** Closes the create dialog if it is open. */
        _closeCreateDialog() {
            if (this._pCreateDialog) {
                this._pCreateDialog.then((oDialog) => oDialog.close());
            }
        },

        /* =========================================================== */
        /* chart                                                       */
        /* =========================================================== */

        /**
         * Reads the full set of invoices (only the fields needed for the chart) and feeds
         * the aggregated result into the "chart" model. Called on init and again after a new
         * invoice has been created, so the chart stays in sync without a manual reload.
         */
        _loadChartData() {
            const oModel = this.getModel();
            oModel.metadataLoaded().then(() => {
                oModel.read("/Invoices", {
                    urlParameters: { "$select": "InvoiceId,InvoiceDate" },
                    success: (oData) => {
                        this._aggregateChartData(oData.results || []);
                    }
                });
            });
        },

        /**
         * Groups the given invoices by calendar month and counts them, producing a
         * chronologically sorted array of { key, month, count } entries for the chart model.
         */
        _aggregateChartData(aInvoices) {
            const oMonthFormat = DateFormat.getDateInstance({ pattern: "MMM yyyy" });
            const mGroups = {};

            aInvoices.forEach((oInvoice) => {
                const oDate = oInvoice.InvoiceDate;
                if (!oDate) {
                    return;
                }
                // OData V2 delivers Edm.DateTime as a JS Date; guard for string just in case.
                const oJsDate = oDate instanceof Date ? oDate : new Date(oDate);
                const sKey = oJsDate.getFullYear() + "-" + String(oJsDate.getMonth() + 1).padStart(2, "0");
                if (!mGroups[sKey]) {
                    mGroups[sKey] = { key: sKey, month: oMonthFormat.format(oJsDate), count: 0 };
                }
                mGroups[sKey].count++;
            });

            const aMonths = Object.keys(mGroups)
                .sort()
                .map((sKey) => mGroups[sKey]);

            this.getModel("chart").setProperty("/months", aMonths);
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
