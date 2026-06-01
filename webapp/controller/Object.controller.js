sap.ui.define([
    "./BaseController",
    "../model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/routing/History",
    "sap/ui/core/library",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (BaseController, formatter, JSONModel, History, coreLibrary, MessageToast, MessageBox) => {
    "use strict";

    const ValueState = coreLibrary.ValueState;

    return BaseController.extend("baclaude.controller.Object", {

        formatter: formatter,

        onInit() {
            const oViewModel = new JSONModel({
                invoiceId: "",
                editMode: false,
                busy: false,
                taxItems: []
            });
            this.setModel(oViewModel, "view");

            this.getRouter().getRoute("object").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched(oEvent) {
            const sInvoiceId = decodeURIComponent(oEvent.getParameter("arguments").invoiceId);
            this.getModel("view").setProperty("/invoiceId", sInvoiceId);

            // Leaving any previous edit state behind when a new invoice is opened
            this._leaveEditMode();

            // Bind the view to the invoice key so future detail content can read its properties
            this.getView().bindElement({
                path: "/" + this.getModel().createKey("Invoices", { InvoiceId: sInvoiceId }),
                events: {
                    dataRequested: () => this.getView().setBusy(true),
                    dataReceived: () => this.getView().setBusy(false)
                }
            });
        },

        /* =========================================================== */
        /* edit mode                                                   */
        /* =========================================================== */

        /** Switches the object page into edit mode. */
        onEdit() {
            this.getModel("view").setProperty("/editMode", true);
        },

        /** Discards all pending changes and returns to display mode. */
        onCancel() {
            const oModel = this.getModel();
            if (oModel.hasPendingChanges()) {
                oModel.resetChanges();
            }
            this._leaveEditMode();
        },

        /** Validates the changed fields and submits an OData update when valid. */
        onSave() {
            const oModel = this.getModel();
            const oContext = this.getView().getBindingContext();
            if (!oContext) {
                return;
            }

            if (!this._validate(oContext.getObject())) {
                return;
            }

            // Item-first: make sure the invoice totals reflect the current line items before saving.
            this._recalculateInvoiceTotals();

            // No actual changes – just leave edit mode without a request
            if (!oModel.hasPendingChanges()) {
                this._leaveEditMode();
                MessageToast.show(this.getResourceBundle().getText("messageNoChanges"));
                return;
            }

            const oView = this.getView();
            const oBundle = this.getResourceBundle();
            const that = this;
            oView.setBusy(true);

            // The service runs in non-batch mode (manifest: useBatch=false). In that mode the
            // success/error callbacks of submitChanges are not invoked by the model, so we listen
            // to the model-level request events instead to reliably react to the update result.
            const oReq = {};
            const fnCleanup = () => {
                oModel.detachRequestCompleted(oReq.completed);
                oModel.detachRequestFailed(oReq.failed);
                oView.setBusy(false);
            };
            oReq.completed = (oEvent) => {
                fnCleanup();
                if (oEvent.getParameter("success")) {
                    that._leaveEditMode();
                    MessageToast.show(oBundle.getText("messageSaveSuccess"));
                } else {
                    MessageBox.error(oBundle.getText("messageSaveError"));
                }
            };
            oReq.failed = () => {
                fnCleanup();
                MessageBox.error(oBundle.getText("messageSaveError"));
            };

            oModel.attachRequestCompleted(oReq.completed);
            oModel.attachRequestFailed(oReq.failed);
            oModel.submitChanges();
        },

        /* =========================================================== */
        /* line items                                                  */
        /* =========================================================== */

        /**
         * Adds a new, empty invoice item to the current invoice and shows it in the table
         * right away. OData V2 does not surface a transient createEntry context in a
         * navigation list binding, so the new position is persisted and the table binding is
         * refreshed – the row appears without a page reload and can then be edited inline.
         * Its amounts roll up into the invoice totals on save (item-first).
         */
        onAddItem() {
            const oModel = this.getModel();
            const oInvoiceContext = this.getView().getBindingContext();
            if (!oInvoiceContext) {
                return;
            }

            const oInvoice = oInvoiceContext.getObject();
            oModel.createEntry("/InvoiceItems", {
                properties: {
                    ItemId: this._nextItemId(),
                    InvoiceId: this.getModel("view").getProperty("/invoiceId"),
                    Description: "",
                    Quantity: "1.000",
                    Unit: "EA",
                    UnitPrice: "0.00",
                    TaxRate: "19.00",
                    TaxCode: "V1",
                    NetAmount: "0.00",
                    TaxAmount: "0.00",
                    GrossAmount: "0.00",
                    Currency: oInvoice.Currency || "EUR"
                }
            });

            const oView = this.getView();
            const oBundle = this.getResourceBundle();
            const that = this;
            oView.setBusy(true);

            // Non-batch mode does not invoke the submitChanges callbacks, so the model-level
            // request events are used to react to the create result (see onSave for details).
            const oReq = {};
            const fnCleanup = () => {
                oModel.detachRequestCompleted(oReq.completed);
                oModel.detachRequestFailed(oReq.failed);
                oView.setBusy(false);
            };
            oReq.completed = (oEvent) => {
                fnCleanup();
                if (oEvent.getParameter("success")) {
                    that.byId("itemsTable").getBinding("items").refresh();
                } else {
                    MessageBox.error(oBundle.getText("messageItemAddError"));
                }
            };
            oReq.failed = () => {
                fnCleanup();
                MessageBox.error(oBundle.getText("messageItemAddError"));
            };

            oModel.attachRequestCompleted(oReq.completed);
            oModel.attachRequestFailed(oReq.failed);
            oModel.submitChanges();
        },

        /**
         * Recalculates the amounts of a single item when one of its editable fields
         * (quantity, unit price, tax rate) changes, then rolls the change up into the
         * invoice totals so the header stays consistent (item-first calculation).
         */
        onItemChange(oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            if (!oContext) {
                return;
            }
            this._recalculateItem(oContext);
            this._recalculateInvoiceTotals();
            this._recalculateTaxItems();
        },

        /**
         * Removes an invoice item. As with adding, OData V2 navigation list bindings do not
         * surface transient deletions, so the entity is removed and the change submitted right
         * away; the table binding is then refreshed so the row disappears without a page reload.
         * Totals and tax positions are recalculated from the remaining items (item-first).
         */
        onDeleteItem(oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            if (!oContext) {
                return;
            }

            const oModel = this.getModel();
            const oView = this.getView();
            const oBundle = this.getResourceBundle();
            const that = this;
            oView.setBusy(true);

            // Non-batch mode does not invoke the submitChanges callbacks, so the model-level
            // request events are used to react to the delete result (see onSave for details).
            const oReq = {};
            const fnCleanup = () => {
                oModel.detachRequestCompleted(oReq.completed);
                oModel.detachRequestFailed(oReq.failed);
                oView.setBusy(false);
            };
            oReq.completed = (oEvt) => {
                fnCleanup();
                if (oEvt.getParameter("success")) {
                    // updateFinished on the refreshed table triggers the tax recalculation.
                    that.byId("itemsTable").getBinding("items").refresh();
                } else {
                    MessageBox.error(oBundle.getText("messageItemDeleteError"));
                }
            };
            oReq.failed = () => {
                fnCleanup();
                MessageBox.error(oBundle.getText("messageItemDeleteError"));
            };

            oModel.attachRequestCompleted(oReq.completed);
            oModel.attachRequestFailed(oReq.failed);
            oModel.remove(oContext.getPath());
        },

        /**
         * Recalculates the aggregated tax positions after the line item table has (re)loaded
         * its rows, e.g. on initial display, growing or after an add/delete refresh.
         */
        onItemsUpdateFinished() {
            this._recalculateTaxItems();
        },

        /** Returns the item row of the current invoice that is currently loaded in the table. */
        _getItemContexts() {
            const oBinding = this.byId("itemsTable").getBinding("items");
            return oBinding ? oBinding.getCurrentContexts() : [];
        },

        /** Derives the next free item id (existing maximum + 10) as a string. */
        _nextItemId() {
            let iMax = 0;
            this._getItemContexts().forEach((oContext) => {
                const iId = parseInt(oContext.getObject().ItemId, 10);
                if (!isNaN(iId) && iId > iMax) {
                    iMax = iId;
                }
            });
            return String(iMax + 10);
        },

        /** Computes net, tax and gross amount of a single item from its quantity, price and tax rate. */
        _recalculateItem(oContext) {
            const oModel = this.getModel();
            const oItem = oContext.getObject();
            const fNet = (parseFloat(oItem.Quantity) || 0) * (parseFloat(oItem.UnitPrice) || 0);
            const fTax = fNet * (parseFloat(oItem.TaxRate) || 0) / 100;
            oModel.setProperty("NetAmount", fNet.toFixed(2), oContext);
            oModel.setProperty("TaxAmount", fTax.toFixed(2), oContext);
            oModel.setProperty("GrossAmount", (fNet + fTax).toFixed(2), oContext);
        },

        /** Aggregates all item amounts into the invoice's net, tax and gross totals. */
        _recalculateInvoiceTotals() {
            const oModel = this.getModel();
            const oInvoiceContext = this.getView().getBindingContext();
            if (!oInvoiceContext) {
                return;
            }

            let fNet = 0;
            let fTax = 0;
            let fGross = 0;
            this._getItemContexts().forEach((oContext) => {
                const oItem = oContext.getObject();
                fNet += parseFloat(oItem.NetAmount) || 0;
                fTax += parseFloat(oItem.TaxAmount) || 0;
                fGross += parseFloat(oItem.GrossAmount) || 0;
            });

            oModel.setProperty("NetAmount", fNet.toFixed(2), oInvoiceContext);
            oModel.setProperty("TaxAmount", fTax.toFixed(2), oInvoiceContext);
            oModel.setProperty("GrossAmount", fGross.toFixed(2), oInvoiceContext);
        },

        /**
         * Aggregates the invoice line items into tax positions, one row per tax rate. The tax
         * base is the sum of the net amounts of all items sharing that rate, the tax amount is
         * the tax base multiplied by the rate. The result is written to the view model so the
         * tax positions table stays in sync whenever an item is added, changed or removed.
         */
        _recalculateTaxItems() {
            const oInvoiceContext = this.getView().getBindingContext();
            const sInvoiceCurrency = oInvoiceContext ? oInvoiceContext.getObject().Currency : "EUR";

            const mGroups = {};
            this._getItemContexts().forEach((oContext) => {
                const oItem = oContext.getObject();
                const fRate = parseFloat(oItem.TaxRate) || 0;
                const sKey = fRate.toFixed(2);
                if (!mGroups[sKey]) {
                    mGroups[sKey] = {
                        TaxRate: fRate,
                        TaxBase: 0,
                        Currency: oItem.Currency || sInvoiceCurrency
                    };
                }
                mGroups[sKey].TaxBase += parseFloat(oItem.NetAmount) || 0;
            });

            const aTaxItems = Object.keys(mGroups)
                .sort((sA, sB) => parseFloat(sB) - parseFloat(sA))
                .map((sKey) => {
                    const oGroup = mGroups[sKey];
                    return {
                        TaxRate: oGroup.TaxRate,
                        TaxBase: oGroup.TaxBase.toFixed(2),
                        TaxAmount: (oGroup.TaxBase * oGroup.TaxRate / 100).toFixed(2),
                        Currency: oGroup.Currency
                    };
                });

            this.getModel("view").setProperty("/taxItems", aTaxItems);
        },

        /* =========================================================== */
        /* internal helpers                                            */
        /* =========================================================== */

        /** Resets edit state and clears any inline validation feedback. */
        _leaveEditMode() {
            this.getModel("view").setProperty("/editMode", false);
            this.byId("inpVendor").setValueState(ValueState.None);
            this.byId("inpCurrency").setValueState(ValueState.None);
            this.byId("dpDueDate").setValueState(ValueState.None);
        },

        /**
         * Validates the editable invoice fields. Shows inline value states and an
         * aggregated error dialog. Returns true when all values are valid.
         */
        _validate(oData) {
            const oBundle = this.getResourceBundle();
            const aMessages = [];

            const oVendor = this.byId("inpVendor");
            const oCurrency = this.byId("inpCurrency");
            const oDueDate = this.byId("dpDueDate");

            [oVendor, oCurrency, oDueDate].forEach((oControl) => oControl.setValueState(ValueState.None));

            // Vendor name must not be empty
            if (!oData.VendorName || !oData.VendorName.trim()) {
                const sMsg = oBundle.getText("validationVendorRequired");
                oVendor.setValueState(ValueState.Error);
                oVendor.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            // Currency must not be empty
            if (!oData.Currency || !oData.Currency.trim()) {
                const sMsg = oBundle.getText("validationCurrencyRequired");
                oCurrency.setValueState(ValueState.Error);
                oCurrency.setValueStateText(sMsg);
                aMessages.push(sMsg);
            }

            // Due date must be present and not in the past
            if (!oData.DueDate) {
                const sMsg = oBundle.getText("validationDueDateRequired");
                oDueDate.setValueState(ValueState.Error);
                oDueDate.setValueStateText(sMsg);
                aMessages.push(sMsg);
            } else {
                const oToday = new Date();
                oToday.setHours(0, 0, 0, 0);
                const oDue = new Date(oData.DueDate);
                oDue.setHours(0, 0, 0, 0);
                if (oDue.getTime() < oToday.getTime()) {
                    const sMsg = oBundle.getText("validationDueDatePast");
                    oDueDate.setValueState(ValueState.Error);
                    oDueDate.setValueStateText(sMsg);
                    aMessages.push(sMsg);
                }
            }

            if (aMessages.length) {
                MessageBox.error(aMessages.join("\n"), {
                    title: oBundle.getText("validationErrorTitle")
                });
                return false;
            }
            return true;
        },

        onNavBack() {
            const oHistory = History.getInstance();
            const sPreviousHash = oHistory.getPreviousHash();
            if (sPreviousHash !== undefined) {
                window.history.go(-1);
            } else {
                this.getRouter().navTo("worklist", {}, true);
            }
        }
    });
});
