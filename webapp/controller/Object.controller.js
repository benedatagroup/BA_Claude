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
                busy: false
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
