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
            this.setModel(new JSONModel({
                itemCount: 0
            }), "view");

            // Separate model that feeds the "invoices per month" chart. It is filled
            // independently of the table binding so the chart always reflects the full
            // data set, regardless of the active list filters.
            this.setModel(new JSONModel({ months: [] }), "chart");

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

        /**
         * Triggers the initial table binding once the SmartFilterBar has finished
         * initializing. Binding the table only from here (and from the filter bar's search
         * event) – rather than auto-connecting via the table's "smartFilterId" – avoids the
         * "getFilters called before the SmartFilterBar is initialized" warning, because the
         * filter bar is guaranteed to be ready before getFilters() is ever called.
         */
        onFilterBarInitialized() {
            this.byId("invoiceSmartTable").rebindTable();
        },

        /** Re-binds the table when the user runs a search on the SmartFilterBar. */
        onFilterBarSearch() {
            this.byId("invoiceSmartTable").rebindTable();
        },

        /**
         * Called once when the SmartTable has created its inner (responsive) table.
         * The columns and the filter fields are generated automatically from the OData
         * metadata; here we only enable row navigation on the generated table:
         * "SingleSelectMaster" makes the whole row clickable, and the selection change
         * navigates to the object page.
         */
        onSmartTableInitialise(oEvent) {
            const oInnerTable = oEvent.getSource().getTable();
            oInnerTable.setMode("SingleSelectMaster");
            oInnerTable.attachSelectionChange(this.onItemSelect, this);
            oInnerTable.attachUpdateFinished(this.onUpdateFinished, this);
        },

        /**
         * Prepares the table binding on every rebind: it merges the SmartFilterBar's current
         * filter values and basic search term into the OData request (so a search produces a
         * filtered request), keeps the inline count for the page header, and applies a default
         * sort order (newest invoices first) when the user has not sorted otherwise.
         */
        onBeforeRebindTable(oEvent) {
            const oBindingParams = oEvent.getParameter("bindingParams");
            oBindingParams.parameters = oBindingParams.parameters || {};
            oBindingParams.parameters.countMode = "Inline";

            const oFilterBar = this.byId("invoiceFilterBar");
            if (oFilterBar.isInitialised()) {
                oBindingParams.filters = oBindingParams.filters || [];

                // Field filters maintained in the SmartFilterBar (translated to $filter).
                oBindingParams.filters = oBindingParams.filters.concat(oFilterBar.getFilters());

                // Basic (free-text) search. The MockServer only understands $filter, not the
                // gateway "search" url parameter, so the search term is turned into a
                // "contains" filter across the main text fields instead.
                const sSearch = (oFilterBar.getBasicSearchValue() || "").trim();
                if (sSearch) {
                    oBindingParams.filters.push(new Filter({
                        filters: [
                            new Filter("InvoiceNumber", FilterOperator.Contains, sSearch),
                            new Filter("VendorName", FilterOperator.Contains, sSearch),
                            new Filter("ReferenceNumber", FilterOperator.Contains, sSearch)
                        ],
                        and: false
                    }));
                }
            }

            oBindingParams.sorter = oBindingParams.sorter || [];
            if (!oBindingParams.sorter.length) {
                oBindingParams.sorter.push(new Sorter("InvoiceDate", true));
            }
        },

        /** Updates the result count shown in the snapped page header after each load. */
        onUpdateFinished(oEvent) {
            const iTotal = oEvent.getParameter("total");
            this.getModel("view").setProperty("/itemCount", iTotal || 0);
        },

        /** Refreshes the OData binding so the latest data is fetched. */
        onRefresh() {
            this.byId("invoiceSmartTable").rebindTable();
            MessageToast.show(this.getResourceBundle().getText("messageRefreshed"));
        },

        /** Navigates to the object page when a row is selected. */
        onItemSelect(oEvent) {
            const oItem = oEvent.getParameter("listItem");
            if (!oItem) {
                return;
            }
            const sInvoiceId = oItem.getBindingContext().getProperty("InvoiceId");
            // Clear the selection so the row is not highlighted on return.
            oEvent.getSource().removeSelections(true);
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
                VendorId: "",
                VendorName: oData.vendorName,
                InvoiceDate: oData.invoiceDate,
                DueDate: oData.dueDate || null,
                PostingDate: null,
                NetAmount: "0.00",
                TaxAmount: "0.00",
                GrossAmount: "0.00",
                Currency: oData.currency,
                Status: "Draft",
                PaymentTerms: "",
                ReferenceNumber: "",
                CompanyCode: "",
                CreatedBy: ""
            };

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
                    that.byId("invoiceSmartTable").rebindTable();
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
        }
    });
});
