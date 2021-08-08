const functions = require('firebase-functions');
const admin = require('firebase-admin');
const moment = require('moment');
admin.initializeApp(functions.config().firebase);
let db = admin.firestore();
let customerRef = db.collection("customers");
let productRef = db.collection("products");
let sellerRef = db.collection('sellers');
let reminderRef = db.collection('reminders');
let taskRef = db.collection('tasks');
let refRef = db.collection('references');
let orderRef = db.collection('orders');
let consignmentRef = db.collection('orders');
let statisticsRef = db.collection("statistics");
let supplierRef = db.collection("suppliers");
let supportRef = db.collection("support");

exports.getStats = functions.https.onCall((data) => {
    let promise;
    //return best selling items/products
    if (data.request.toLowerCase() === 'bestsellers') {
        let products = [];
        let bestSellers = {};
        let key = 'bestSellers';
        bestSellers[key] = [];
        promise = productRef.get().then((snapshot) => {
            snapshot.forEach((doc) => {
                products.push({
                    productName: String(doc.data().productName),
                    sold: Number(doc.data().productsSold)
                });
            });
            products.sort((a, b) => Number(b.sold) - Number(a.sold));
            for (let j = 0; j < 8; j++) {
                bestSellers[key].push(products[j]);
            }
            console.log("Success");
            return JSON.stringify(bestSellers);
        }).catch((reason) => {
            console.log("Error " + reason);
            return JSON.stringify(reason);
        });
    }
    //return best buying customers
    if (data.request.toLowerCase() === 'customers') {
        let customers = [];
        let bestCustomers = {};
        let key = 'bestCustomers';
        bestCustomers[key] = [];
        promise = customerRef.get().then((snapshot) => {
            snapshot.forEach((doc) => {
                customers.push({
                    customerName: String(doc.data().firmName),
                    orderedTotal: doc.data().customerOrderedTotal
                });
            });
            customers.sort((a, b) => parseFloat(b.orderedTotal) - parseFloat(a.orderedTotal));
            for (let i = 0; i < 8; i++) {
                bestCustomers[key].push(customers[i]);
            }
            console.log("Success");
            return JSON.stringify(bestCustomers);
        }).catch((reason) => {
            console.log("Error " + reason);
            return JSON.stringify(reason);
        });
    }
    return promise;
});

exports.sendNotification = functions.firestore.document('/products/{productID}').onUpdate(async (change) => {
    const product = change.after.data();
    let promises = [];
    if (product.productStock <= 5) {
        //make notification
        let append_postfix;
        switch (product.productStock) {
            case 1:
                append_postfix = 'kos';
                break;
            case 2:
                append_postfix = 'kosa';
                break;
            case 3:
                append_postfix = 'kosi';
                break;
            default:
                append_postfix = 'kosov';
                break;
        }
        const notification_msg = {
            notification: {
                title: 'Nizka zaloga!',
                body: `Zaloga izdelka ${product.productName} je ${product.productStock} ` + append_postfix
            }
        };
        let sellers = await sellerRef.listDocuments();
        sellers.forEach(seller => {
            promises.push(admin.firestore().collection('devices').where('ID', '==', seller.ID).get());
        });
        let devices = await Promise.all(promises);
        let tokens = [];
        for (let x = 0; x < devices.length; x++) {
            tokens.push(devices[x].data().token);
            console.log(devices[x].data().token);
        }
        admin.messaging().sendToDevice(tokens, notification_msg);
        const registrationTokens = 'ewnWRaPx_Yo:APA91bFz-oB6TMvsBaPmso3cf6UtBDgeSoWcm2OIO2fJXp9KWLCEEbH3s7GfBU0XwoOtbF1Ra3kJCJY9ULDWcsT2J-WMnvetnaT0vhIMqroqY7tGQesAp4rQ82tsEbHeLGbcoq28IyVX';
        //send notification to device

        promises.push(admin.messaging().sendToDevice(registrationTokens, notification_msg)
            .then(response => {
                console.log('Notification sent successfully:', response);
                return response;
            })
            .catch(error => {
                console.log('Notification sent failed:', error);
                return error;
            }));
        return Promise.all(promises);
    } else {
        return null;
    }
});

exports.handleReminders = functions.firestore.document('/products/{productID}').onUpdate(async (change) => {
    const product_now = change.after.data();
    const product_before = change.before.data();
    const promises = [];
    //make reminder if stock is <5
    return admin.firestore().runTransaction(async transaction => {
            if (product_now.productStock <= 5) {
                const date = admin.firestore.FieldValue.serverTimestamp();
                const reminder = {
                    productReference: change.before.ref,
                    reminderDate: date,
                    reminderStatus: 'Potrebno je naročilo'
                };
                const task = {
                    uploaderID: "dZQnikepmFTp19cMIqySSDoukvr1",
                    taskDate: date,
                    taskTitle: `Naroči ${product_now.productName}`,
                    taskStatus: 'Nedokončano',
                    taskFinished: null,
                    priority: 1,
                    taskContent: `Potrebno je naročilo izdelka ${product_now.productName}.`,
                };
                promises.push(transaction.set(reminderRef.doc(product_now.productBarcode), reminder, {merge: true}));
                promises.push(transaction.set(taskRef.doc(), task));

            } else if (product_before.productStock <= 5 && product_now.productStock > 5) {
                promises.push(transaction.update(reminderRef.doc(product_now.productBarcode), {reminderStatus: 'Ponovno na zalogi'}));
            }
            return Promise.all(promises);
        }
    );
});

exports.createCustomerReference = functions.firestore.document('/customers/{customer}').onCreate(async (snapshot) => {
    let customerRef = snapshot.ref;
    let customerData = snapshot.data();
    let promises = [];
    try {
        if (customerData.customerReference !== null) {
            console.log("customer reference is already set.");
        } else {
            promises.push(admin.firestore().runTransaction(async transaction => {
                let p = [];
                let customerNumber = (await transaction.get(refRef.doc('customerReference'))).data().currentID;
                p.push(transaction.update(customerRef, {customerReference: customerNumber}));
                p.push(transaction.update(refRef.doc('customerReference'), {currentID: admin.firestore.FieldValue.increment(1)}));
                console.log("success");
                return Promise.all(p);
            }));
        }
        if (customerData.customerNumberOfOrders === null) {
            promises.push(customerRef.update({customerNumberOfOrders: 0.0}));
        }
        if (customerData.customerOrderedTotal === null) {
            promises.push(customerRef.update({customerOrderedTotal: 0.0}));
        }
        if (customerData.customerPaidTotal === null) {
            promises.push(customerRef.update({customerPaidTotal: 0.0}));
        }
    } catch (e) {
        console.log(e);
    }
    return Promise.all(promises);
});

exports.createProductReference = functions.firestore.document('/products/{product}').onCreate(async (snapshot) => {
    let productRef = snapshot.ref;
    let num = 0, productData = snapshot.data();
    let promises = [];
    try {
        if (productData.productReference !== null) {
            console.log("product reference is already set.");
        } else {
            promises.push(admin.firestore().runTransaction(async transaction => {
                let x = [];
                let numberRef = refRef.doc('productReference');
                num = (await transaction.get(numberRef)).data().currentID;
                x.push(transaction.update(productRef, {productReference: num}));
                x.push(transaction.update(numberRef, {currentID: admin.firestore.FieldValue.increment(1)}));
                x.push(transaction.update(productData.supplierReference, {supplierProducts: admin.firestore.FieldValue.arrayUnion(productRef)}));
                console.log("success");
                return Promise.all(x);
            }));
        }
        if (productData.productsSold === null) {
            promises.push(productRef.update({productsSold: 0.0}));
        }
        if (productData.lastUpdated === null) {
            promises.push(productRef.update({lastUpdated: admin.firestore.FieldValue.serverTimestamp()}));
        }
        if (productData.productStock === null) {
            promises.push(productRef.update({productStock: 0}));
        }
        if (productData.productSKU === null) {
            promises.push(productRef.update({productSKU: 1}));
        }
    } catch (e) {
        console.log(e);
    }
    return Promise.all(promises);
});

exports.createOrderReference = functions.firestore.document('/orders/{order}').onCreate(async (snapshot) => {
    let id = snapshot.id; //id of order document
    let sellerReference = snapshot.data().sellerReference;
    let orderNumber = 0, promises = [];
    try {
        return admin.firestore().runTransaction(async (transaction) => {
            let seller = await transaction.get(sellerReference);
            orderNumber = seller.data().orderReferenceNumber;
            promises.push(transaction.update(orderRef.doc(id), {orderReference: orderNumber}));
            promises.push(transaction.update(sellerReference, {orderReferenceNumber: admin.firestore.FieldValue.increment(1)}));
            console.log("success");
            return Promise.all(promises);
        });
    } catch (e) {
        console.log(e);
        return null;
    }
});

exports.generatePDF = functions.firestore.document('/orders/{order}').onCreate(async (snapshot) => {
    let promises = [];
    let sellerReference = snapshot.data().sellerReference;
    let seller = await sellerReference.get();
    let orderNumber = seller.data().orderReferenceNumber;
    try {
        promises.push(generatePDF(snapshot, orderNumber + 1));
    } catch (e) {
        console.log(e);
    }
    return Promise.all(promises);
});

async function generatePDF(snapshot, orderNumber) {
    let order = snapshot.data();
    let promises = [];
    return new Promise((async (resolve, reject) => {
        try {
            const pdf = require('pdfkit');
            let document = new pdf;
            document.info = {Title: 'Naročilo ' + orderNumber, Author: 'Reno d.o.o.'};
            let pos = 0;
            generateHeader(document);
            promises.push(generateCustomerInformation(document, order, orderNumber));
            pos = await generateInvoiceTable(document, order);
            promises.push(generateFooter(document, order, pos));
            let file = admin.storage().bucket().file('Naročila/Naročilo ' + snapshot.id + " " + moment(order.orderTimestamp.toDate()).add(1, 'hour').format("DD.MM.YYYY HH:mm") + '.pdf');
            let stream = file.createWriteStream({
                private: false,
                metadata: {
                    contentType: "application/pdf",
                }
            });
            await Promise.all(promises);
            document.pipe(stream);
            await document.end();
            await stream.end();
            resolve();
        } catch (e) {
            console.log(e);
            reject(e);
        }
    }));
}

function generateHeader(doc) {
    let position = doc.page.height / 10 - 15;
    doc.fontSize(20)
        .font("Helvetica-Bold")
        .text("Reno d.o.o.", 50, position, {align: "left"})
        .fontSize(10)
        .text("Hacquetova ulica 4", 50, position + 30, {align: "left"})
        .text("1000 Ljubljana", 50, position + 45, {align: "left"})
        .text("Slovenija", 50, position + 60, {align: "left"})
        .moveDown();
}

async function generateCustomerInformation(doc, order, orderNumber) {
    let position = doc.page.height / 6 + 30;
    let seller = (await order.sellerReference.get()).data();
    let customer = (await order.customerReference.get()).data();
    generateHr(doc, position - 15);
    doc.font("Times-Bold")
        .text(`Št. narocila: ${orderNumber}`, 50, position, {font: "Helvetica"})
        .text(`Datum narocila: ${moment(order.orderTimestamp.toDate()).add(1, 'hour').format('DD.MM.YYYY HH:mm')}`, 50, position + 15)
        .text(`Placilo do: ${moment().add(20, "days").format('DD.MM.YYYY')}`, 50, position + 30)
        .text(`Prodajalec: ${seller.sellerName + " " + seller.sellerSurname}`, 50, position + 45)
        .text(`${customer.firmName}`, 200, position, {align: "right"})
        .text(`${customer.customerAddress}`, 200, position + 15, {align: "right"})
        .text(`${customer.customerPost}`, 200, position + 30, {align: "right"})
        .moveDown();
    generateHr(doc, position + 60);
}

function generateTableRow(doc, y, c1, c2, c3, c4, c5, c6) {
    doc.fontSize(10)
        .font("Times-Roman")
        .text(c1, 50, y)
        .text(c2, 150, y)
        .text(c3, 235, y, {width: 50, align: "right"})
        .text(c4, 330, y, {width: 60, align: "right"})
        .text(c5, 400, y, {width: 50, align: "right"})
        .text(c6, 0, y, {align: "right"});
    generateHr(doc, y + 15)
}

async function generateInvoiceTable(doc, order) {
    let invoiceTableTop = doc.page.height / 2 - 100;
    generateTableHeader(doc, invoiceTableTop);
    let orderProducts = order.productList;
    let numProducts = order.productNumbers;
    let orderDiscount = order.orderDiscount;
    let productDiscounts = order.productDiscount;
    let hasOrderDiscount = order.hasOrderDiscount;
    let total = 0;
    let position;
    for (let i = 0; i < orderProducts.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        let item = (await orderProducts[i].get()).data();
        position = invoiceTableTop + (i + 1) * 30;
        let sum = Number(item.productPrice * numProducts[item.productBarcode] * (1 - productDiscounts[item.productBarcode]) * item.productVATValue).toFixed(2);
        total += Number(sum);
        let vat;
        if (Number(item.productVATValue) === 1.095) {
            vat = 9.5
        } else {
            vat = 22;
        }
        generateTableRow(doc, position,
            item.productName,
            Number(item.productPrice).toFixed(2) + " €",
            vat + "%",
            numProducts[item.productBarcode],
            productDiscounts[item.productBarcode] * 100 + "%",
            sum + " €");
    }
    doc.fontSize(10)
        .font("Times-Bold").text("Skupaj brez popusta:", 400, position + 30, {width: 100, align: "right"})
        .text(Number(total).toFixed(2) + " €", 0, position + 30, {align: "right"});
    doc.fontSize(10)
        .font("Times-Bold").text("Popust:", 400, position + 60, {width: 100, align: "right"})
        .text(Number(order.orderDiscount * 100).toFixed(2) + "%", 0, position + 60, {align: "right"});
    generateHr(doc, position + 75);
    doc.fontSize(10)
        .font("Times-Bold").text("Skupaj:", 400, position + 90, {width: 100, align: "right"})
        .text(Number(total * (1 - order.orderDiscount)).toFixed(2) + " €", 0, position + 90, {align: "right"});
    return position + 200;
}

function generateTableHeader(doc, invoiceTableTop) {
    doc.fontSize(10)
        .font("Times-Bold")
        .text("Izdelek", 50, invoiceTableTop)
        .text("Cena brez DDV", 150, invoiceTableTop)
        .text("DDV", 235, invoiceTableTop, {width: 50, align: "right"})
        .text("Št. izdelkov", 330, invoiceTableTop, {width: 60, align: "right"})
        .text("Popust", 400, invoiceTableTop, {width: 50, align: "right"})
        .text("Skupaj", 0, invoiceTableTop, {align: "right"});
    generateHr(doc, invoiceTableTop + 15);
}

async function generateFooter(doc, order, position) {
    let text = "Podpis stranke";
    if (order.pickupMethod.toLowerCase() === "pošta") {
        text = text.concat(' na pošti');
    }
    if (order.pickupMethod.toLowerCase() === "prevzem" && order.signatureURL !== "") {
        let url = order.signatureURL;
        await new Promise(((resolve, reject) => {
            try {
                const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
                let xhr = new XMLHttpRequest();
                xhr.responseType = 'arraybuffer';
                xhr.addEventListener('load', async (event) => {
                    doc.image(Buffer.from(new Uint8Array(xhr.response)), 100, position, {align: "right", scale: 0.25});
                    resolve();
                });
                xhr.addEventListener('error', (e) => reject(e));
                xhr.open('GET', url, true);
                xhr.send();
            } catch (e) {
                reject(e);
            }
        }));
    }
    doc.fontSize(10)
        .font("Times-Roman")
        .text(text, 70, position + 140, {align: "right"})
        .font("Times-Bold")
        .text("Hvala za nakup!", 50, position + 150, {align: "center", width: 500});
}

function generateHr(doc, y) {
    doc.strokeColor("#aaaaaa")
        .lineWidth(1)
        .moveTo(50, y)
        .lineTo(550, y)
        .stroke();
}

exports.onReportCreation = functions.firestore.document('/reports/{report}').onCreate(async (snapshot) => {
    let report = snapshot.data();
    let numPackages = report.packagesTotal;
    let numProducts = report.productsTotal;
    let supplierOrderRef = report.supplierOrderRef;
    return admin.firestore().runTransaction(async transaction => {
        let promises = [];
        let packages = [];
        try {
            let packageRefs = report.packageReferences;
            for (let i = 0; i < packageRefs.length; i++) {
                packages.push(transaction.get(packageRefs[i]));
            }
            let prodPackages = await Promise.all(packages);
            for (let i = 0; i < prodPackages.length; i++) {
                let barcode = prodPackages[i].data().packageBarcode;
                console.log(prodPackages[i]);
                promises.push(transaction.update(prodPackages[i].ref, {
                    receivedPackages: admin.firestore.FieldValue.increment(Number(numPackages[barcode])),
                    lastReceived: moment().toDate()
                }));
                promises.push(transaction.update(prodPackages[i].data().productReference, {
                    productStock: admin.firestore.FieldValue.increment(Number(numProducts[barcode])),
                    lastUpdated: moment().toDate()
                }));
            }
            // eslint-disable-next-line no-eq-null,eqeqeq
            if (supplierOrderRef != null) {
                promises.push(transaction.update(supplierOrderRef, {status: 1}));
                promises.push(transaction.update(supplierOrderRef, {deliveredDate: admin.firestore.FieldValue.serverTimestamp()}));
            }
        } catch (e) {
            console.log(e);
        }
        return Promise.all(promises);
    });
});

exports.onPackageCreation = functions.firestore.document('/packages/{package}').onCreate(async (snapshot) => {
    let pkg = snapshot.data();
    let promises = [];
    return admin.firestore().runTransaction(async (transaction) => {
        let product = await transaction.get(pkg.productReference);
        console.log(pkg);
        let prod = product.docs;
        try {
            let productName = prod[0].data().productName;
            promises.push(transaction.update(snapshot.ref, {packageContent: String(productName + "-" + pkg.packageProductNumber)}));
        } catch (e) {
            console.log(e);
        }
        return Promise.all(promises);
    });
});

exports.insertStats = functions.firestore.document('/orders/{order}').onCreate(async (snapshot) => {
    let promises = [], productList = snapshot.data().productList;
    let seller = snapshot.data().sellerReference;
    let index = 0;
    let year = String(moment().year());
    let monthFormat = moment(moment(), 'YYYY/MM/DD');
    let month = monthFormat.format('MMMM');
    let productStats = statisticsRef.doc(year).collection(month).doc('products');
    try {
        return admin.firestore().runTransaction(async (transaction) => {
            let customer = await transaction.get(snapshot.data().customerReference);
            let customerStats = statisticsRef.doc(year).collection(month).doc('customers').collection(String(customer.data().customerReference)).doc(String(customer.data().customerReference));
            let customerStat = await transaction.get(customerStats);
            let productPromises = [];
            console.log("getting product snapshots");
            for (; index < productList.length; index++) {
                console.log(productList[index]);
                productPromises.push(transaction.get(productList[index]));
            }
            console.log("got product snapshots");
            index = 0;
            let productSnapshots = await Promise.all(productPromises);
            let statisticPromises = [];
            console.log("getting statistic snapshots");
            for (; index < productSnapshots.length; index++) {
                console.log(productSnapshots[index]);
                statisticPromises.push(transaction.get(productStats.collection(String(productSnapshots[index].data().productReference)).doc(String(productSnapshots[index].data().productReference))));
                index++;
            }
            console.log("got statistics");
            index = 0;
            let statisticSnapshots = await Promise.all(statisticPromises);
            console.log("updating product stats");
            let productsSold = snapshot.data().productNumbers;
            for (; index < statisticSnapshots.length; index++) {
                let product = productSnapshots[index].data();
                let orderProductsSold = Number(productsSold[product.productBarcode]);
                let productRef = String(product.productReference);
                console.log(productRef);
                promises.push(transaction.update(productList[index], {
                    productsSold: admin.firestore.FieldValue.increment(orderProductsSold),
                    productStock: admin.firestore.FieldValue.increment(-orderProductsSold),
                }));
                if (statisticSnapshots[index].exists) {
                    promises.push(transaction.update(productStats.collection(productRef).doc(productRef), {
                        productsSold: admin.firestore.FieldValue.increment(orderProductsSold),
                        productPrice: statisticSnapshots[index].data().productPrice,
                        productStock: admin.firestore.FieldValue.increment(-orderProductsSold),
                        productName: product.productName
                    }));
                } else {
                    let productStat = {
                        productPrice: product.productPrice,
                        productName: product.productName,
                        productsSold: orderProductsSold,
                        productStock: product.productStock
                    };
                    promises.push(transaction.create(productStats.collection(String(product.productReference)).doc(productRef), productStat));
                }
            }
            console.log("updated product stats");
            console.log("updating customer stats");
            if (customerStat.exists) {
                promises.push(transaction.update(customerStats, {
                    customerOrderedTotal: admin.firestore.FieldValue.increment(Number(snapshot.data().orderTotal)),
                    customerNumberOfOrders: admin.firestore.FieldValue.increment(1)
                }));
            } else {
                let customerStat = {
                    customerNumberOfOrders: 1,
                    customerOrderedTotal: Number(snapshot.data().orderTotal.toFixed(2)),
                    firmName: customer.data().firmName
                };
                promises.push(transaction.create(customerStats, customerStat));
            }
            promises.push(transaction.update(snapshot.data().customerReference, {
                customerOrderedTotal: admin.firestore.FieldValue.increment(snapshot.data().orderTotal),
                customerNumberOfOrders: admin.firestore.FieldValue.increment(1)
            }));
            promises.push(transaction.update(seller, {soldTotal: admin.firestore.FieldValue.increment(snapshot.data().orderTotal)}));
            console.log("updated customer stats");
            console.log("success");
            return Promise.all(promises);
        });
    } catch (e) {
        console.log(e);
        return null;
    }
});

exports.onCreateConsignment = functions.firestore.document('/consignments/{consignment}').onCreate(async (snapshot, context) => {
    let consignmentData = snapshot.data();
    let products = consignmentData.consignmentProductList;
    let numProducts = consignmentData.consignmentProductNumbers;
    let promises = [];
    return admin.firestore().runTransaction(async transaction => {
        let productSnaps = [];
        for (let i = 0; i < products.length; i++) {
            productSnaps.push(transaction.get(products[i]));
        }
        let a = await Promise.all(productSnaps);
        for (let i = 0; i < products.length; i++) {
            promises.push(transaction.update(products[i], {
                lastUpdated: moment().toDate(),
                productStock: admin.firestore.FieldValue.increment(-Number(numProducts[a[i].data().productBarcode]))
            }));
        }
        return Promise.all(promises);
    });
});

//close an consignment => make an order from item's sold info
exports.closeConsignment = functions.https.onCall(async (data) => {
    let consignmentID = data.consignmentID;
    let consignment = consignmentRef.doc(consignmentID);
    let consignmentClosed = admin.firestore.FieldValue.serverTimestamp();
    let promises = [];
    let one = 1;
    let productsSold, productsConsigned, discount, consignmentTotal = 0.0, index = 0;
    try {
        await admin.firestore().runTransaction(async transaction => {
            let consignmentSnapShot = await transaction.get(consignment);
            let consignmentData = consignmentSnapShot.data();
            let sellerData = await transaction.get(consignmentData.sellerReference);
            let productReferences = consignmentData.consignmentProductList;
            let pSold = consignmentData.consignmentProductsSold;
            let numProducts = consignmentData.consignmentProductNumbers;
            let productDiscounts = consignmentData.consignmentProductDiscounts;
            let consignmentDiscount = consignmentData.consignmentDiscount;
            for (let x = 0; x < productReferences.length; x++) {
                promises.push(transaction.get(productReferences[x]));
            }
            let newPromises = await Promise.all(promises);
            promises = [];
            for (; index < newPromises.length; index++) {
                let product = newPromises[index].data();
                let barcode = product.productBarcode;
                productsSold = Number(pSold[barcode]);
                discount = Number(productDiscounts[barcode]);
                productsConsigned = Number(numProducts[barcode]);
                let delta = productsConsigned - productsSold;
                let productTotal = Number((one - discount) * product.productPrice * productsSold * product.productVATValue);
                productTotal *= Number((one - parseFloat(consignmentDiscount)).toFixed(2));
                consignmentTotal += productTotal;
                promises.push(transaction.update(productReferences[index], {
                    productStock: admin.firestore.FieldValue.increment(delta),
                    productsSold: admin.firestore.FieldValue.increment(productsSold),
                    lastUpdated: consignmentClosed
                }));
            }
            let orderFromConsignment = {
                productList: consignmentData.consignmentProductList,
                orderDiscount: consignmentDiscount,
                customerReference: consignmentData.customerReference,
                orderTimestamp: consignmentClosed,
                hasOrderDiscount: consignmentData.hasOrderDiscount,
                productNumbers: pSold,
                productDiscount: consignmentData.consignmentProductDiscounts,
                orderReference: sellerData.data().orderReferenceNumber + 1,
                sellerReference: consignmentData.sellerReference,
                signatureURL: String(consignmentData.signatureURL),
                pickupMethod: String(consignmentData.pickupMethod),
                orderTotal: Number(consignmentTotal.toFixed(2)),
                isPaid: false
            };
            promises.push(transaction.set(orderRef.doc(), orderFromConsignment));
            promises.push(transaction.update(consignment, {
                consignmentStatus: 'closed',
                consignmentTotal: Number(consignmentTotal.toFixed(2)),
                consignmentClosed: consignmentClosed
            }));
            promises.push(transaction.update(consignmentData.sellerReference, {
                consignmentOrderReference: sellerData.data().orderReferenceNumber,
            }));
            return Promise.all(promises);
        });
        return "OK";
    } catch (e) {
        console.log(e);
        return "ERR";
    }
});

exports.travellingExpenses = functions.https.onCall(async (data) => {
    let promises = [];
    try {
        let distances = {};
        let week = moment().isoWeek();
        if (data.hasOwnProperty('monday')) {
            distances["monday"] = data.monday;
        }
        if (data.hasOwnProperty('tuesday')) {
            distances["tuesday"] = data.tuesday;
        }
        if (data.hasOwnProperty('wednesday')) {
            distances["wednesday"] = data.wednesday;
        }
        if (data.hasOwnProperty('thursday')) {
            distances["thursday"] = data.thursday;
        }
        if (data.hasOwnProperty('friday')) {
            distances["friday"] = data.friday;
        }
        await admin.firestore().runTransaction(async transaction => {
                try {
                    let sellerQuery = await sellerRef.where('ID', '==', data.UID).get();
                    if (sellerQuery.size > 0) {
                        let seller = sellerQuery.docs[0].ref;
                        let weekQuery = seller.collection("expenses").doc("travelling").collection(moment().format("YYYY")).doc("Week " + String(week));
                        let result = await transaction.get(weekQuery);
                        if (result.exists) {
                            let distArray = result.data().distances;
                            if (distances["monday"] !== null && distArray["monday"] < distances["monday"] && distances["monday"] !== 0) {
                                let usersUpdate = {};
                                usersUpdate[`distances.monday`] = distances["monday"];
                                promises.push(transaction.update(weekQuery, usersUpdate));
                            }
                            if (distances["tuesday"] !== null && distArray["tuesday"] < distances["tuesday"] && distances["tuesday"] !== 0) {
                                let usersUpdate = {};
                                usersUpdate[`distances.tuesday`] = distances["tuesday"];
                                promises.push(transaction.update(weekQuery, usersUpdate));
                            }
                            if (distances["wednesday"] !== null && distArray["wednesday"] < distances["wednesday"] && distances["wednesday"] !== 0) {
                                let usersUpdate = {};
                                usersUpdate[`distances.wednesday`] = distances["wednesday"];
                                promises.push(transaction.update(weekQuery, usersUpdate));
                            }
                            if (distances["thursday"] !== null && distArray["thursday"] < distances["thursday"] && distances["thursday"] !== 0) {
                                let usersUpdate = {};
                                usersUpdate[`distances.thursday`] = distances["thursday"];
                                promises.push(transaction.update(weekQuery, usersUpdate));
                            }
                            if (distances["friday"] !== null && distArray["friday"] < distances["friday"] && distances["friday"] !== 0) {
                                let usersUpdate = {};
                                usersUpdate[`distances.friday`] = distances["friday"];
                                promises.push(transaction.update(weekQuery, usersUpdate));
                            }
                        } else {
                            promises.push(transaction.set(weekQuery, {week: week, distances: distances}));
                        }
                    }
                } catch (e) {
                    console.log(e);
                }
                return Promise.all(promises);
            }
        );
        return "Success";
    } catch
        (e) {
        console.log(e);
        return "ERR";
    }
});

exports.travellingExpensesReport = functions.https.onCall(async (data, context) => {
    let selectedUser = data.user;
    return new Promise(async (resolve, reject) => {
        try {
            let dist = [];
            let expenses = await sellerRef.doc(selectedUser).collection("expenses").doc("travelling").collection(moment().format("YYYY")).listDocuments();
            let docs = [];
            await expenses.forEach(week => {
                docs.push(week.get());
            });
            let abcd = await Promise.all(docs);
            abcd.forEach(element => {
                let distances = element.data().distances;
                let week = element.data().week;
                console.log(distances);
                dist.push({week: week, distances: distances});
            });
            resolve(dist);
        } catch (e) {
            console.log(e);
            reject(e);
        }
    });
});

exports.inventoryReport = functions.https.onCall(async (data) => {
    let products = [];
    return new Promise(async (resolve, reject) => {
        try {
            let year = data.year;
            let months = await statisticsRef.doc(year).listCollections(); //months
            let productSnaps = [];
            for (let i = 0; i < months.length; i++) {
                // eslint-disable-next-line no-await-in-loop
                let productCollections = await statisticsRef.doc(year).collection(months[i].id).doc("products").listCollections();
                for (let j = 0; j < productCollections.length; j++) {
                    let productRef = statisticsRef.doc(year).collection(months[i].id).doc("products").collection(productCollections[j].id).doc(productCollections[j].id);
                    products.push(productRef);
                }
            }
            await products.forEach(product => {
                productSnaps.push(product.get());
            });
            let sth = await Promise.all(productSnaps);
            products = [];
            await sth.forEach(snap => {
                products.push({data: snap.data(), id: snap.id});
            });
        } catch (e) {
            reject(e);
            console.log(e);
        }
        resolve(products);
    });
});

exports.uploadExcelFiles = functions.https.onCall(async (data, context) => {
    let objs = data.objs;
    let option = data.option;
    console.log(data);
    try {
        let batch = db.batch();
        for (let i = 0; i < objs.length; i++) {
            let obj = objs[i];
            let reference;
            if (option === ("customers")) {
                reference = String(obj.customerReference);
                // eslint-disable-next-line no-await-in-loop
                if ((await customerRef.where("customerReference", '==', reference).get()).size === 0) {
                    batch.set(customerRef.doc(reference), obj);
                }
            } else if (option === ("products")) {
                reference = String(obj.productReference);
                // eslint-disable-next-line no-await-in-loop
                if ((await productRef.where("productReference", '==', reference).get()).size === 0) {
                    batch.set(productRef.doc(reference), obj);
                }
            }
        }
        await batch.commit();
        return JSON.stringify("OK");
    } catch (e) {
        console.log(e);
        return JSON.stringify("OK");
    }
});

exports.getMonths = functions.https.onCall(async (data) => {
    return statisticsRef.doc(data.year).listCollections();
});

exports.getSupplierOrders = functions.https.onCall(async (data) => {
    let ret = [], promises = [];
    let suppliers = await supplierRef.listDocuments();
    suppliers.forEach(supplier => {
        promises.push(supplier.collection("supplierOrders").where('status', '==', 0).get().then((docs) => {
            return docs.forEach(element => {
                // eslint-disable-next-line eqeqeq,no-eq-null
                if (element != null) {
                    let order = {};
                    order["ID"] = element.id;
                    order["reference"] = element.ref.path;
                    order["status"] = element.data().status;
                    try {
                        order["orderDate"] = element.data().orderDate;
                        order["supplierReference"] = supplier.path;
                    } catch (e) {
                        console.log(e);
                    }
                    ret.push(order);
                }
            });
        }).catch(e => {
            console.log(e);
        }));
    });
    await Promise.all(promises);
    return JSON.stringify(ret);
});

exports.isPaidCheck = functions.firestore.document('/orders/{order}').onUpdate(async (snapshot, context) => {
    let promises = [];
    return db.runTransaction(async transaction => {
        let before = snapshot.before.data();
        let after = snapshot.after.data();
        let isPaidPrev = before.paid;
        let isPaidNew = after.paid;
        if (!isPaidPrev && isPaidNew) {
            let customer = before.customerReference;
            promises.push(transaction.update(customer, {customerPaidTotal: admin.firestore.FieldValue.increment(parseFloat(before.orderTotal))}));
        }
        return Promise.all(promises);
    });
});

exports.sendSupportRequest = functions.https.onCall(async (data) => {
    return supportRef.doc().set({requestSent: moment().toDate(), requestStatus: 0, contactInfo: data.contactInfo});
});