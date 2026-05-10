sap.ui.define([
    "./BaseController",
    "../model/formatter",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/routing/History"
], (BaseController, formatter, JSONModel, History) => {
    "use strict";

    return BaseController.extend("baclaude.controller.Object", {

        formatter: formatter,

        onInit() {
            const oViewModel = new JSONModel({
                invoiceId: ""
            });
            this.setModel(oViewModel, "view");

            this.getRouter().getRoute("object").attachPatternMatched(this._onObjectMatched, this);
        },

        _onObjectMatched(oEvent) {
            const sInvoiceId = decodeURIComponent(oEvent.getParameter("arguments").invoiceId);
            this.getModel("view").setProperty("/invoiceId", sInvoiceId);

            // Bind the view to the invoice key so future detail content can read its properties
            this.getView().bindElement({
                path: "/" + this.getModel().createKey("Invoices", { InvoiceId: sInvoiceId }),
                events: {
                    dataRequested: () => this.getView().setBusy(true),
                    dataReceived: () => this.getView().setBusy(false)
                }
            });
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
